import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'

export interface ResearchedFeature { dimension: string; value: string }
export interface ResearchResult {
  description: string | null
  descriptionEn: string | null
  releaseDate: string | null
  features: ResearchedFeature[]
}

export const DESCRIPTION_DIM = '__description'
export const DESCRIPTION_EN_DIM = '__description_en'
export const RELEASED_DIM = '__released'
/** Marker: Produkt wurde per Web-Research angefragt (auch bei Leer-Ergebnis). Verhindert,
 *  dass der tägliche Cron dieselben Produkte ohne auffindbare Web-Daten endlos neu anfragt. */
export const RESEARCHED_AT_DIM = '__researched_at'

const FeatureSchema = z.object({ dimension: z.string(), value: z.string().trim().min(1).max(200), source_url: z.string().trim().optional() })
const ReportSchema = z.object({
  description: z.string().trim().max(800).optional(),
  description_en: z.string().trim().max(800).optional(),
  release_date: z.string().trim().max(40).optional(),
  features: z.array(z.unknown()).optional(),
})
const EMPTY = new Set(['unbekannt', 'unknown', 'n/a', 'na', '-', 'keine angabe'])

/** Entfernt web_search-Citation-Markup (<cite index="...">…</cite>) aus dem Text. */
function stripCite(s: string): string {
  return s.replace(/<\/?cite[^>]*>/g, '').trim()
}

/** Pure: validiert die Research-Antwort gegen die gültigen Dimensionen. */
export function parseResearchResponse(raw: unknown, validDimensions: Set<string>): ResearchResult {
  const outer = ReportSchema.safeParse(raw)
  if (!outer.success) return { description: null, descriptionEn: null, releaseDate: null, features: [] }
  const features: ResearchedFeature[] = []
  const seen = new Set<string>()
  for (const f of outer.data.features ?? []) {
    const p = FeatureSchema.safeParse(f)
    if (!p.success || !validDimensions.has(p.data.dimension) || seen.has(p.data.dimension)) continue
    if (EMPTY.has(p.data.value.toLowerCase())) continue
    // Citation-Pflicht: nur Werte mit echter Web-Quelle behalten (kein Spekulieren).
    if (!p.data.source_url || !/^https?:\/\//i.test(p.data.source_url)) continue
    seen.add(p.data.dimension)
    features.push({ dimension: p.data.dimension, value: stripCite(p.data.value) })
  }
  return {
    description: outer.data.description ? stripCite(outer.data.description) || null : null,
    descriptionEn: outer.data.description_en ? stripCite(outer.data.description_en) || null : null,
    releaseDate: outer.data.release_date?.trim() || null,
    features,
  }
}

const RESEARCH_TIMEOUT_MS = 180_000
const REPORT_TOOL = {
  name: 'report_research',
  description: 'Melde die recherchierten Produktdaten mit Quellen',
  input_schema: {
    type: 'object' as const,
    properties: {
      description: { type: 'string' },
      description_en: { type: 'string' },
      release_date: { type: 'string' },
      features: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dimension: { type: 'string' },
            value: { type: 'string' },
            source_url: { type: 'string', description: 'URL der Web-Quelle, die diesen Wert belegt (Pflicht)' },
          },
          required: ['dimension', 'value', 'source_url'],
        },
      },
    },
    required: ['description', 'description_en', 'features'],
  },
}
const EMPTY_RESULT: ResearchResult = { description: null, descriptionEn: null, releaseDate: null, features: [] }

/**
 * Recherchiert ein Produkt per WEB-SUCHE (Sonnet 4.6). Jeder Spec-Wert MUSS eine
 * source_url (echte Web-Quelle) tragen — parseResearchResponse verwirft Werte ohne
 * Beleg. Kein Spekulieren, kein Schätzen: unbelegte Dimensionen bleiben leer.
 * Die Newsletter-Auszüge dienen nur als Suchhilfe/Kontext, nicht als Beleg.
 */
export async function researchProduct(
  name: string, vendor: string, categoryName: string, dimensions: string[], evidence: string,
): Promise<ResearchResult> {
  if (!process.env.ANTHROPIC_API_KEY) return EMPTY_RESULT
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const dims = dimensions.map((d) => `- ${d}`).join('\n')
  const prompt = `Recherchiere per WEB-SUCHE die offiziellen, aktuellen Specs des AI-Produkts "${name}" von ${vendor} (Kategorie: ${categoryName}).
${evidence ? `\nKontext aus AI-News (nur als Suchhilfe, KEIN Beleg):\n${evidence}\n` : ''}
Nutze die Web-Suche AKTIV (Hersteller-Seiten, offizielle Doku, Benchmark-Listen, seriöse Tech-Quellen) und rufe dann report_research:
1. description: 2-4 nüchterne Sätze DEUTSCH (kein Marketing).
2. description_en: dieselbe Aussage ENGLISCH.
3. release_date: Erscheinungsdatum, falls in einer Quelle belegt.
4. features: für JEDE dieser Dimensionen (dimension EXAKT wie unten) den belegten Wert MIT source_url:
${dims}

STRIKT — KEIN SPEKULIEREN:
- Gib einen feature-Wert NUR an, wenn du ihn in einer konkreten Web-Quelle gefunden hast, und trage die belegende source_url ein.
- Findest du einen Wert nicht belegt, LASS die Dimension WEG. Niemals schätzen, raten oder aus Allgemeinwissen ergänzen.
- Alle Daten existieren im Netz — suche gründlich (mehrere Suchanfragen), bevor du eine Dimension auslässt.`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS)
  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 4000,
      tools: [REPORT_TOOL, { type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
      messages: [{ role: 'user', content: prompt }],
    }, { signal: controller.signal })
    const block = [...resp.content].reverse().find((b: { type: string; name?: string }) => b.type === 'tool_use' && b.name === 'report_research')
    return parseResearchResponse(block && 'input' in block ? block.input : null, new Set(dimensions))
  } catch {
    return EMPTY_RESULT
  } finally {
    clearTimeout(timer)
  }
}

const META_DIMS = new Set<string>(['__sentiment', DESCRIPTION_DIM, DESCRIPTION_EN_DIM, RELEASED_DIM, RESEARCHED_AT_DIM])

/** Recherchiert sichtbare, kategorisierte Produkte (Top nach Mentions) und schreibt
 *  Beschreibung/Release/Specs nach product_features_current (source research).
 *  `concurrency` > 1 verarbeitet Produkte parallel (Web-Research ist I/O-gebunden) —
 *  default 1 hält das Cron-Verhalten unverändert. `onProgress` für Fortschritt. */
export async function runProductResearch(
  opts: { limit?: number; minMentions?: number; force?: boolean; concurrency?: number; onProgress?: (researched: number, attempted: number) => void } = {},
): Promise<{ researched: number }> {
  const { limit = 60, minMentions = 2, force = false, concurrency = 1, onProgress } = opts
  const supabase = createAdminClient()

  const { data: cats } = await supabase.from('product_categories').select('slug, name, feature_dimensions')
  const catBySlug = new Map((cats ?? []).map((c) => [c.slug as string, c]))

  // Memberships paginiert laden — PostgREST cappt sonst still bei 1000 Zeilen.
  type Membership = { product_id: string; category: string; products: unknown }
  const memberships: Membership[] = []
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase
      .from('product_category_membership')
      .select('product_id, category, products:product_id(canonical_name, vendor_namespace, visibility_status)')
      .eq('is_primary', true).range(off, off + 999)
    if (!data?.length) break
    memberships.push(...(data as Membership[]))
    if (data.length < 1000) break
  }

  /** Recherchiert + schreibt EIN Produkt. Rückgabe: true bei geschriebenem Ergebnis. */
  const researchOne = async (m: Membership): Promise<boolean> => {
    const prod = Array.isArray(m.products) ? m.products[0] : m.products
    if (!prod || (prod as { visibility_status?: string }).visibility_status !== 'visible') return false
    const cat = catBySlug.get(m.category)
    if (!cat) return false

    const { count: mc } = await supabase.from('product_mentions').select('id', { count: 'exact', head: true }).eq('product_id', m.product_id)
    if ((mc ?? 0) < minMentions) return false
    // schon mit echten FEATURES recherchiert? Nur dann skippen — Produkte mit bloßer
    // Beschreibung (ohne Feature-Tabelle) sollen die Web-Research nachträglich bekommen.
    if (!force) {
      // Skip, wenn schon echte Features vorhanden ODER bereits angefragt (Marker) —
      // verhindert tägliches Neu-Anfragen von Produkten ohne auffindbare Web-Daten.
      const { data: existing } = await supabase.from('product_features_current')
        .select('dimension_key').eq('product_id', m.product_id)
      const keys = (existing ?? []).map((f) => f.dimension_key as string)
      if (keys.some((k) => !META_DIMS.has(k)) || keys.includes(RESEARCHED_AT_DIM)) return false
    }

    const dimensions = Array.isArray(cat.feature_dimensions) ? (cat.feature_dimensions as string[]) : []
    // News-Auszüge als zusätzlicher Beleg (die eigentliche Quelle ist die Web-Suche)
    const { data: ments } = await supabase
      .from('product_mentions').select('excerpt').eq('product_id', m.product_id)
      .not('excerpt', 'is', null).order('mention_date', { ascending: false }).limit(25)
    const evidence = (ments ?? [])
      .map((x) => (x.excerpt as string)?.trim()).filter(Boolean).map((e) => `- ${e}`).join('\n').slice(0, 8000)
    const res = await researchProduct(
      (prod as { canonical_name: string }).canonical_name, (prod as { vendor_namespace: string }).vendor_namespace,
      cat.name as string, dimensions, evidence,
    )

    const rows: Array<Record<string, unknown>> = res.features.map((f) => ({
      product_id: m.product_id, category: m.category, dimension_key: f.dimension,
      value_text: f.value, confidence: 0.85, evidence_count: 1, source_count: 1,
    }))
    if (res.description) rows.push({ product_id: m.product_id, category: m.category, dimension_key: DESCRIPTION_DIM, value_text: res.description, confidence: 0.85, evidence_count: 1, source_count: 1 })
    if (res.descriptionEn) rows.push({ product_id: m.product_id, category: m.category, dimension_key: DESCRIPTION_EN_DIM, value_text: res.descriptionEn, confidence: 0.85, evidence_count: 1, source_count: 1 })
    if (res.releaseDate) rows.push({ product_id: m.product_id, category: m.category, dimension_key: RELEASED_DIM, value_text: res.releaseDate, confidence: 0.85, evidence_count: 1, source_count: 1 })
    // Marker IMMER schreiben (auch bei Leer-Ergebnis) → force=false fragt dieses Produkt
    // nicht erneut an (keine täglichen Retry-Kosten für Produkte ohne Web-Daten).
    rows.push({ product_id: m.product_id, category: m.category, dimension_key: RESEARCHED_AT_DIM, value_text: new Date().toISOString(), confidence: 1, evidence_count: 0, source_count: 0 })
    // Force: alte Dimensionswerte entfernen, damit nach einer Dimensions-Umstellung
    // keine verwaisten Features (nicht mehr in feature_dimensions) übrig bleiben.
    if (force) {
      await supabase.from('product_features_current').delete().eq('product_id', m.product_id)
        .not('dimension_key', 'in', `(${['__sentiment', DESCRIPTION_DIM, DESCRIPTION_EN_DIM, RELEASED_DIM].join(',')})`)
    }
    const { error } = await supabase.from('product_features_current').upsert(rows, { onConflict: 'product_id,category,dimension_key' })
    if (error) throw new Error(`research upsert: ${error.message}`)
    return res.features.length > 0 || !!res.description
  }

  // Bounded-Concurrency-Pool: Worker ziehen Kandidaten bis `limit` Erfolge oder erschöpft.
  let researched = 0
  let attempted = 0
  let idx = 0
  const worker = async () => {
    while (researched < limit && idx < memberships.length) {
      const my = idx++
      attempted++
      try {
        if (await researchOne(memberships[my])) researched++
      } catch (e) {
        // Einzelne Fehler (z.B. transienter Upsert) dürfen den Batch nicht abbrechen.
        console.error(`[research] Produkt ${memberships[my].product_id}:`, e instanceof Error ? e.message : e)
      }
      onProgress?.(researched, attempted)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()))
  return { researched }
}
