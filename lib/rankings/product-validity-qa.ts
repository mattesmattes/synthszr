import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Kontextbasierte Produkt-Validitäts-QS: Der Extraktor (Haiku) legt gelegentlich
 * gängige Wörter als Chart-Produkt an, für die es zwar ein gleichnamiges echtes
 * Produkt gibt (Apple "Vision", Bland AI "Norm", pitch.com), das Wort im
 * Nachrichtentext aber die Alltagsbedeutung hat. Dieser Pass gibt die Original-
 * Textstellen (product_mentions.excerpt) an ein LLM und blendet das Produkt aus
 * (visibility_status='excluded'), wenn es dort überwiegend KEIN Produkt bezeichnet.
 * Marker verhindert Re-Processing; `limit` deckelt die LLM-Kosten.
 */

export const VALIDITY_QA_AT_DIM = '__validity_qa_at'
const FALLBACK_CATEGORY = 'other'
const LLM_TIMEOUT_MS = 50_000
const EXCLUDE_CONFIDENCE = 0.8
// Produkte mit vielen Erwähnungen sind eindeutig echte Produkte (ein Alltagswort
// sammelt keine 40 KI-News-Erwähnungen als vermeintliches Produkt) — nicht prüfen.
const MAX_MENTIONS = 40
const MAX_EXCERPTS = 3

export interface ValidityCandidate {
  id: string
  name: string
  excerpts: string[]
}

/** Pure: baut den Validitäts-Prompt. Konservativ — im Zweifel „ist Produkt". */
export function buildValidityPrompt(c: ValidityCandidate): string {
  const ex = c.excerpts.length
    ? c.excerpts.map((e, i) => `${i + 1}. „…${e}…"`).join('\n')
    : '(keine Textstellen verfügbar)'
  return `In einem Ranking von KI-Produkten steht der Eintrag "${c.name}". Er wurde automatisch aus Nachrichtentexten extrahiert. Manche gängigen Wörter (z.B. „Vision", „Norm", „Pitch", „Edits", „LLM") sind zufällig auch Produktnamen, im Text aber als ganz normales Wort gemeint.

Prüfe anhand der Original-Textstellen, ob "${c.name}" dort ein eigenständiges KI-Produkt / Tool / Modell / Feature bezeichnet ODER ein gewöhnliches Wort im Satz ist.

TEXTSTELLEN:
${ex}

Antworte via Tool:
- is_product: true, wenn "${c.name}" in den Stellen (überwiegend) ein konkretes benanntes KI-Produkt/Tool/Modell bezeichnet; false, wenn es (überwiegend) ein Allerwelts-/Fachwort in normaler Bedeutung ist.
- confidence: 0..1 (wie sicher).
- reasoning: ein kurzer Satz.

WICHTIG: Im Zweifel is_product=true. Blende NUR aus, wenn das Wort eindeutig in Alltagsbedeutung steht (z.B. „die Vision des Unternehmens", „ein guter Pitch", „Datei-Edits").`
}

const DecisionSchema = z.object({
  is_product: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

export interface ValidityDecision { isProduct: boolean; confidence: number; reasoning: string }

/** Pure: validiert die Tool-Antwort. Ungültig ⇒ null. */
export function parseValidityDecision(raw: unknown): ValidityDecision | null {
  const p = DecisionSchema.safeParse(raw)
  if (!p.success) return null
  return { isProduct: p.data.is_product, confidence: p.data.confidence, reasoning: p.data.reasoning }
}

async function decideValidity(c: ValidityCandidate): Promise<ValidityDecision | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { getModelForUseCase } = await import('@/lib/ai/model-config')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const tool = {
    name: 'judge_validity',
    description: 'Entscheiden, ob ein Chart-Eintrag ein echtes Produkt oder ein Alltagswort ist',
    input_schema: {
      type: 'object' as const,
      properties: {
        is_product: { type: 'boolean' },
        confidence: { type: 'number' },
        reasoning: { type: 'string' },
      },
      required: ['is_product', 'confidence', 'reasoning'],
    },
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const model = await getModelForUseCase('ranking_validity_qa')
    const resp = await client.messages.create({
      model, max_tokens: 512, tools: [tool],
      tool_choice: { type: 'tool', name: 'judge_validity' },
      messages: [{ role: 'user', content: buildValidityPrompt(c) }],
    }, { signal: controller.signal })
    const block = resp.content.find((b) => b.type === 'tool_use')
    return parseValidityDecision(block && 'input' in block ? block.input : null)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

type Sb = ReturnType<typeof createAdminClient>

async function setMarker(sb: Sb, productId: string, category: string, verdict: string): Promise<void> {
  // product_features_current.category hat NOT NULL FK auf product_categories.slug —
  // daher die ECHTE Primärkategorie nutzen (Fallback 'other'). Sonst FK-Violation →
  // Marker nie persistiert → Endlos-Reprocessing.
  const { error } = await sb.from('product_features_current').upsert(
    { product_id: productId, category, dimension_key: VALIDITY_QA_AT_DIM, value_text: `${new Date().toISOString()} ${verdict}`.slice(0, 500) },
    { onConflict: 'product_id,category,dimension_key' },
  )
  if (error) console.error('[validity-qa] setMarker:', error.message, productId)
}

/**
 * Tägliche QS: chartable Single-Word-Produkte mit wenigen Erwähnungen kontextbasiert
 * validieren. Alltagswörter (LLM-Urteil is_product=false, Confidence ≥ 0.8) werden
 * ausgeblendet; alle anderen bekommen nur den Marker. Marker verhindert Re-Processing.
 */
export interface ValidityOutcome { name: string; mentions: number; isProduct: boolean | null; confidence: number | null; action: 'excluded' | 'kept'; reasoning: string }

export async function runProductValidityQA(opts: { limit?: number; dryRun?: boolean } = {}): Promise<{ excluded: number; kept: number; checked: number; decisions: ValidityOutcome[] }> {
  const limit = opts.limit ?? 15
  const dryRun = opts.dryRun ?? false
  const sb = createAdminClient()

  // 1. chartable Mention-Counts (nur wenige Erwähnungen sind verdächtig)
  const mc = new Map<string, number>()
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from('product_metrics').select('product_id, mention_count').eq('chartable', true).order('product_id').range(off, off + 999)
    if (!data?.length) break
    for (const m of data) mc.set(m.product_id as string, (m.mention_count as number) ?? 0)
    if (data.length < 1000) break
  }
  // 2. sichtbare Produkte
  const prods: Array<{ id: string; canonical_name: string; version: string | null; qualifier: string | null }> = []
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from('products').select('id, canonical_name, version, qualifier').eq('visibility_status', 'visible').order('id').range(off, off + 999)
    if (!data?.length) break
    prods.push(...(data as typeof prods))
    if (data.length < 1000) break
  }
  // 3. Primärkategorie (FK-sicherer Marker)
  const primaryCat = new Map<string, string>()
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from('product_category_membership').select('product_id, category').eq('is_primary', true).order('product_id').range(off, off + 999)
    if (!data?.length) break
    for (const r of data) primaryCat.set(r.product_id as string, r.category as string)
    if (data.length < 1000) break
  }
  const catOf = (id: string) => primaryCat.get(id) ?? FALLBACK_CATEGORY
  // 4. bereits verarbeitet (Marker)
  const marked = new Set<string>()
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from('product_features_current').select('product_id').eq('dimension_key', VALIDITY_QA_AT_DIM).order('product_id').range(off, off + 999)
    if (!data?.length) break
    for (const r of data) marked.add(r.product_id as string)
    if (data.length < 1000) break
  }

  // 5. Kandidaten: chartable, unmarkiert, Single-Word-Name, keine Version/Qualifier,
  //    wenige Erwähnungen. Sortiert nach Erwähnungen DESC (sichtbarere zuerst).
  const candidates = prods.filter((p) => {
    if (marked.has(p.id)) return false
    const m = mc.get(p.id)
    if (m === undefined || m > MAX_MENTIONS) return false
    if (p.version || p.qualifier) return false
    const name = (p.canonical_name || '').trim()
    return name.length >= 2 && !/\s/.test(name) // Single-Word (Multi-Word ist eindeutiger)
  }).sort((a, b) => (mc.get(b.id) ?? 0) - (mc.get(a.id) ?? 0)).slice(0, limit)

  let excluded = 0, kept = 0, checked = 0
  const decisions: ValidityOutcome[] = []
  for (const c of candidates) {
    const { data: ex } = await sb.from('product_mentions').select('excerpt').eq('product_id', c.id).not('excerpt', 'is', null).limit(MAX_EXCERPTS)
    const excerpts = (ex ?? []).map((r) => (r.excerpt as string | null)?.trim().slice(0, 240) ?? '').filter(Boolean)
    const decision = await decideValidity({ id: c.id, name: c.canonical_name, excerpts })
    checked++
    const doExclude = !!decision && !decision.isProduct && decision.confidence >= EXCLUDE_CONFIDENCE
    decisions.push({
      name: c.canonical_name, mentions: mc.get(c.id) ?? 0,
      isProduct: decision?.isProduct ?? null, confidence: decision?.confidence ?? null,
      action: doExclude ? 'excluded' : 'kept', reasoning: decision?.reasoning ?? '(kein LLM-Ergebnis)',
    })
    try {
      if (doExclude) {
        if (!dryRun) {
          const { error } = await sb.from('products').update({ visibility_status: 'excluded' }).eq('id', c.id)
          if (error) { console.error('[validity-qa] exclude:', error.message, c.id); continue }
          await setMarker(sb, c.id, catOf(c.id), `excluded: ${decision!.reasoning}`.slice(0, 400))
        }
        excluded++
      } else {
        if (!dryRun) await setMarker(sb, c.id, catOf(c.id), `kept${decision ? `: ${decision.reasoning}` : ' (kein LLM-Ergebnis)'}`.slice(0, 400))
        kept++
      }
    } catch (e) {
      console.error('[validity-qa] apply:', e instanceof Error ? e.message : e)
    }
  }
  return { excluded, kept, checked, decisions }
}
