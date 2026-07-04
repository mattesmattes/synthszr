import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { mergeProductsInto } from '@/lib/rankings/consolidate'

/** Pseudo-Dimension als Verarbeitungs-Marker (analog __researched_at). */
export const ATTRIBUTION_QA_AT_DIM = '__attribution_qa_at'
const MARKER_CATEGORY = '__meta'
const LLM_TIMEOUT_MS = 50_000
const MERGE_CONFIDENCE = 0.8

export interface QaSibling { id: string; slug: string; vendor: string; mentions: number }
export interface QaCandidate {
  id: string; slug: string; vendor: string; family: string; name: string
  mentions: number; context?: string; siblings: QaSibling[]
}

/** Pure: baut den Verifikations-Prompt. Das Modell darf NUR in eines der gelisteten
 *  Kanon-Produkte mergen (oder null) — keine freie Firmen-Erfindung. */
export function buildAttributionPrompt(c: QaCandidate): string {
  const sibs = c.siblings.length
    ? c.siblings.map((s) => `- ${s.slug} (Hersteller: ${s.vendor}, ${s.mentions} Erwähnungen)`).join('\n')
    : '(keine)'
  return `Ein AI-Produkt in unseren Charts ist evtl. dem falschen/keinem Unternehmen zugeordnet.

PRODUKT: "${c.name}" (aktueller Hersteller-Namespace: "${c.vendor}", ${c.mentions} Erwähnungen)
KONTEXT (aus einer Nachricht): ${c.context ?? '(keiner)'}

MÖGLICHE KANON-PRODUKTE (gleiche Modell-Familie, anderer Hersteller):
${sibs}

Entscheide, ob "${c.name}" in Wahrheit DASSELBE Produkt wie eines der Kanon-Produkte ist
(dann gehört es dorthin gemerged). Beispiele: "Codex" gehört zu OpenAI; ein Artikel, in dem
JetBrains Codex-Support ankündigt, macht Codex NICHT zu einem JetBrains-Produkt.

Antworte via Tool:
- merge_into_slug: der slug des Kanon-Produkts, in das gemerged werden soll — ODER null, wenn es ein eigenständiges/anderes Produkt ist oder unklar.
- confidence: 0..1.
- company: der korrekte Hersteller-Name (auch wenn kein Merge), oder null.
- reasoning: kurz.`
}

const DecisionSchema = z.object({
  merge_into_slug: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  company: z.string().nullable(),
  reasoning: z.string(),
})

export interface AttributionDecision { mergeIntoSlug: string | null; confidence: number; company: string | null; reasoning: string }

/** Pure: validiert die Tool-Antwort. Ungültig ⇒ null. */
export function parseAttributionDecision(raw: unknown): AttributionDecision | null {
  const p = DecisionSchema.safeParse(raw)
  if (!p.success) return null
  return { mergeIntoSlug: p.data.merge_into_slug, confidence: p.data.confidence, company: p.data.company, reasoning: p.data.reasoning }
}

async function decideAttribution(c: QaCandidate): Promise<AttributionDecision | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { getModelForUseCase } = await import('@/lib/ai/model-config')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const tool = {
    name: 'attribute_product',
    description: 'Company-Zuordnung eines Produkts verifizieren',
    input_schema: {
      type: 'object' as const,
      properties: {
        merge_into_slug: { type: ['string', 'null'] },
        confidence: { type: 'number' },
        company: { type: ['string', 'null'] },
        reasoning: { type: 'string' },
      },
      required: ['merge_into_slug', 'confidence', 'company', 'reasoning'],
    },
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const model = await getModelForUseCase('ranking_attribution_qa')
    const resp = await client.messages.create({
      model, max_tokens: 512, tools: [tool],
      tool_choice: { type: 'tool', name: 'attribute_product' },
      messages: [{ role: 'user', content: buildAttributionPrompt(c) }],
    }, { signal: controller.signal })
    const block = resp.content.find((b) => b.type === 'tool_use')
    return parseAttributionDecision(block && 'input' in block ? block.input : null)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

type Sb = ReturnType<typeof createAdminClient>

async function setMarker(sb: Sb, productId: string): Promise<void> {
  await sb.from('product_features_current').upsert(
    { product_id: productId, category: MARKER_CATEGORY, dimension_key: ATTRIBUTION_QA_AT_DIM, value_text: new Date().toISOString() },
    { onConflict: 'product_id,category,dimension_key' },
  )
}

async function flag(sb: Sb, row: Record<string, unknown>): Promise<void> {
  await sb.from('attribution_qa_flags').insert(row)
}

/**
 * Tägliche QS: unknown-/Fragment-Produkte korrekt zuordnen. Deterministisch (eindeutiges
 * Geschwister) bzw. LLM-verifiziert (Merge in existierendes Kanon-Produkt bei Confidence
 * ≥ 0.8). Marker verhindert Re-Processing; `limit` deckelt LLM-Kosten.
 */
export async function runAttributionQA(opts: { limit?: number; minMentions?: number } = {}): Promise<{ merged: number; flagged: number; marked: number }> {
  const limit = opts.limit ?? 15
  const minMentions = opts.minMentions ?? 2
  const sb = createAdminClient()

  // 1. Mention-Counts (chartable) aus product_metrics
  const mc = new Map<string, number>()
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from('product_metrics').select('product_id, mention_count').gte('mention_count', minMentions).order('product_id').range(off, off + 999)
    if (!data?.length) break
    for (const m of data) mc.set(m.product_id as string, (m.mention_count as number) ?? 0)
    if (data.length < 1000) break
  }
  // 2. alle sichtbaren Produkte
  const prods: Array<{ id: string; slug: string; vendor_namespace: string; family: string; canonical_name: string }> = []
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from('products').select('id, slug, vendor_namespace, family, canonical_name').eq('visibility_status', 'visible').order('id').range(off, off + 999)
    if (!data?.length) break
    prods.push(...(data as typeof prods))
    if (data.length < 1000) break
  }
  // 3. bereits verarbeitete (Marker)
  const marked = new Set<string>()
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from('product_features_current').select('product_id').eq('dimension_key', ATTRIBUTION_QA_AT_DIM).order('product_id').range(off, off + 999)
    if (!data?.length) break
    for (const r of data) marked.add(r.product_id as string)
    if (data.length < 1000) break
  }
  // 4. Family-Index (nur sichtbare)
  const byFamily = new Map<string, typeof prods>()
  for (const p of prods) byFamily.set(p.family, [...(byFamily.get(p.family) ?? []), p])

  const mentionsOf = (id: string) => mc.get(id) ?? 0
  const isChartable = (id: string) => mc.has(id)

  // 5. Kandidaten: chartable, unmarkiert, entweder unknown ODER Minderheits-Fragment.
  const candidates = prods.filter((p) => {
    if (marked.has(p.id) || !isChartable(p.id)) return false
    if (p.vendor_namespace === 'unknown') return true
    // Minderheits-Fragment: gleicher family, anderer Vendor dominiert deutlich
    const fam = byFamily.get(p.family) ?? []
    const dominant = fam.find((q) => q.id !== p.id && q.vendor_namespace !== p.vendor_namespace && mentionsOf(q.id) >= 3 * Math.max(1, mentionsOf(p.id)))
    return !!dominant && mentionsOf(p.id) < 5
  }).sort((a, b) => mentionsOf(b.id) - mentionsOf(a.id)).slice(0, limit)

  let merged = 0, flagged = 0, markedCount = 0

  for (const c of candidates) {
    const fam = (byFamily.get(c.family) ?? []).filter((q) => q.id !== c.id && q.vendor_namespace !== c.vendor_namespace)
    // 5a. Deterministisch: unknown + genau EIN bekannter Vendor in der family
    const knownVendors = new Set(fam.filter((q) => q.vendor_namespace !== 'unknown').map((q) => q.vendor_namespace))
    if (c.vendor_namespace === 'unknown' && knownVendors.size === 1) {
      const target = fam.filter((q) => q.vendor_namespace !== 'unknown').sort((a, b) => mentionsOf(b.id) - mentionsOf(a.id))[0]
      await mergeProductsInto(sb, target.id, [c.id])
      await flag(sb, { product_id: c.id, slug: c.slug, current_vendor: c.vendor_namespace, action: 'merged', merged_into_slug: target.slug, confidence: 1, reasoning: 'deterministisch: eindeutiges Vendor-Geschwister' })
      merged++; continue // Quelle gelöscht → kein Marker nötig
    }
    // 5b. LLM: Kontext-Excerpt + Kandidaten-Geschwister
    const { data: ex } = await sb.from('product_mentions').select('excerpt').eq('product_id', c.id).not('excerpt', 'is', null).limit(1)
    const siblings: QaSibling[] = fam.map((q) => ({ id: q.id, slug: q.slug, vendor: q.vendor_namespace, mentions: mentionsOf(q.id) }))
      .sort((a, b) => b.mentions - a.mentions).slice(0, 5)
    const decision = await decideAttribution({
      id: c.id, slug: c.slug, vendor: c.vendor_namespace, family: c.family, name: c.canonical_name,
      mentions: mentionsOf(c.id), context: (ex?.[0]?.excerpt as string | undefined)?.trim().slice(0, 220), siblings,
    })
    const target = decision?.mergeIntoSlug ? siblings.find((s) => s.slug === decision.mergeIntoSlug) : undefined
    if (decision && target && decision.confidence >= MERGE_CONFIDENCE) {
      await mergeProductsInto(sb, target.id, [c.id])
      await flag(sb, { product_id: c.id, slug: c.slug, current_vendor: c.vendor_namespace, action: 'merged', merged_into_slug: target.slug, suggested_company: decision.company, confidence: decision.confidence, reasoning: decision.reasoning })
      merged++; continue // gelöscht → kein Marker
    }
    // 5c. kein sicherer Merge → flaggen (falls Firma vorgeschlagen) bzw. „kept", dann Marker
    await flag(sb, {
      product_id: c.id, slug: c.slug, current_vendor: c.vendor_namespace,
      action: decision?.company ? 'flagged' : 'kept',
      suggested_company: decision?.company ?? null, confidence: decision?.confidence ?? null, reasoning: decision?.reasoning ?? 'kein LLM-Ergebnis',
    })
    if (decision?.company) flagged++
    await setMarker(sb, c.id); markedCount++
  }
  return { merged, flagged, marked: markedCount }
}
