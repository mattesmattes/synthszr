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

const FeatureSchema = z.object({ dimension: z.string(), value: z.string().trim().min(1).max(200) })
const ReportSchema = z.object({
  description: z.string().trim().max(800).optional(),
  description_en: z.string().trim().max(800).optional(),
  release_date: z.string().trim().max(40).optional(),
  features: z.array(z.unknown()).optional(),
})
const EMPTY = new Set(['unbekannt', 'unknown', 'n/a', 'na', '-', 'keine angabe'])
const LLM_TIMEOUT_MS = 90_000

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

const REPORT_TOOL = {
  name: 'report_research',
  description: 'Melde die recherchierten Produktdaten',
  input_schema: {
    type: 'object' as const,
    properties: {
      description: { type: 'string' },
      description_en: { type: 'string' },
      release_date: { type: 'string' },
      features: { type: 'array', items: { type: 'object', properties: { dimension: { type: 'string' }, value: { type: 'string' } }, required: ['dimension', 'value'] } },
    },
    required: ['description', 'description_en', 'features'],
  },
}
const EMPTY_RESULT: ResearchResult = { description: null, descriptionEn: null, releaseDate: null, features: [] }

/**
 * Recherchiert ein Produkt per WEB-SUCHE + Plausibilitätsgate:
 *  1. webResearch: web_search liefert Beschreibung + Spec-Werte (darf breit suchen).
 *  2. plausibilityGate: zweiter, skeptischer Call verwirft Specs ohne glaubwürdige
 *     Stützung — fängt Halluzinationen bei evtl. nicht existenten Produkten ab.
 *  Newsletter-Auszüge dienen als zusätzlicher Kontext/Beleg.
 */
export async function researchProduct(
  name: string, vendor: string, categoryName: string, dimensions: string[], evidence: string,
): Promise<ResearchResult> {
  if (!process.env.ANTHROPIC_API_KEY) return EMPTY_RESULT
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const validDims = new Set(dimensions)

  // --- 1. Web-Recherche ---
  const dims = dimensions.map((d) => `- ${d}`).join('\n')
  const webPrompt = `Recherchiere das AI-Produkt "${name}" von ${vendor} (Kategorie: ${categoryName}).

QUELLEN (beide gleichwertig nutzen):
1. WEB-SUCHE für verlässliche, aktuelle Daten.
2. Diese AI-NEWSLETTER-BELEGE — bei neuen/unbekannten Produkten, die die Web-Suche nicht findet, sind sie die PRIMÄRE Quelle. Extrahiere konkrete Angaben (Preise, Benchmarks, Datum) auch direkt aus diesen Belegen:
${evidence || '(keine)'}

Rufe dann report_research:
1. description: 2-4 nüchterne Sätze auf DEUTSCH (kein Marketing).
2. description_en: dieselbe Aussage auf ENGLISCH.
3. release_date: Erscheinungsdatum (z.B. "Juni 2026") — suche aktiv in Web UND Belegen danach.
4. features: konkrete Werte für diese Dimensionen (dimension EXAKT wie unten):
${dims}
   WICHTIG, falls die Dimensionen das abdecken: Preise/Kosten, Benchmark-Ergebnisse (SWE-bench, MMLU, Terminal-Bench …) und Kontextfenster gehören in die jeweils passende Dimension — diese Angaben stehen oft in den Belegen, übernimm sie.

Belege jeden Wert durch eine Web-Quelle ODER die Newsletter-Belege. Findest du gar nichts Verlässliches, gib KEINE erfundenen Werte an — lieber leer als halluziniert.`
  let raw = EMPTY_RESULT
  const c1 = new AbortController()
  const t1 = setTimeout(() => c1.abort(), LLM_TIMEOUT_MS)
  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 2500,
      tools: [REPORT_TOOL, { type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
      messages: [{ role: 'user', content: webPrompt }],
    }, { signal: c1.signal })
    const block = [...resp.content].reverse().find((b: { type: string; name?: string }) => b.type === 'tool_use' && b.name === 'report_research')
    raw = parseResearchResponse(block && 'input' in block ? block.input : null, validDims)
  } catch {
    return EMPTY_RESULT
  } finally {
    clearTimeout(t1)
  }
  if (raw.features.length === 0) return raw // nichts zu gaten

  // --- 2. Plausibilitätsgate ---
  const gateTool = {
    name: 'report_gate',
    description: 'Melde die geprüften, belegten Features',
    input_schema: { type: 'object' as const, properties: { features: { type: 'array', items: { type: 'object', properties: { dimension: { type: 'string' }, value: { type: 'string' } }, required: ['dimension', 'value'] } } }, required: ['features'] },
  }
  const featList = raw.features.map((f) => `- ${f.dimension}: ${f.value}`).join('\n')
  const gatePrompt = `Produkt "${name}" von ${vendor}. Recherchierte Feature-Werte:
${featList}

Newsletter-Belege als Kontext:
${evidence || '(keine)'}

Prüfe JEDES Feature streng und behalte NUR Werte, die plausibel und durch eine glaubwürdige Quelle oder die Belege gestützt sind. Verwirf erfundene, spekulative oder widersprüchliche Werte — insbesondere bei Produkten, deren Existenz nicht verifizierbar ist. Rufe report_gate ausschließlich mit den behaltenen Features.`
  const c2 = new AbortController()
  const t2 = setTimeout(() => c2.abort(), LLM_TIMEOUT_MS)
  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1000,
      tools: [gateTool], tool_choice: { type: 'tool', name: 'report_gate' },
      messages: [{ role: 'user', content: gatePrompt }],
    }, { signal: c2.signal })
    const block = resp.content.find((b: { type: string; name?: string }) => b.type === 'tool_use' && b.name === 'report_gate')
    const input = block && 'input' in block ? (block.input as { features?: unknown[] }) : null
    const kept: ResearchedFeature[] = []
    const seen = new Set<string>()
    for (const f of input?.features ?? []) {
      const p = FeatureSchema.safeParse(f)
      if (!p.success || !validDims.has(p.data.dimension) || seen.has(p.data.dimension)) continue
      if (EMPTY.has(p.data.value.toLowerCase())) continue
      seen.add(p.data.dimension)
      kept.push({ dimension: p.data.dimension, value: stripCite(p.data.value) })
    }
    return { ...raw, features: kept }
  } catch {
    return raw // Gate-Fehler → ungefilterte (lieber als gar nichts)
  } finally {
    clearTimeout(t2)
  }
}

/** Recherchiert sichtbare, kategorisierte Produkte (Top nach Mentions) und schreibt
 *  Beschreibung/Release/Specs nach product_features_current (source research). */
export async function runProductResearch(opts: { limit?: number; minMentions?: number; force?: boolean } = {}): Promise<{ researched: number }> {
  const { limit = 60, minMentions = 2, force = false } = opts
  const supabase = createAdminClient()

  const { data: cats } = await supabase.from('product_categories').select('slug, name, feature_dimensions')
  const catBySlug = new Map((cats ?? []).map((c) => [c.slug as string, c]))

  const { data: memberships } = await supabase
    .from('product_category_membership')
    .select('product_id, category, products:product_id(canonical_name, vendor_namespace, visibility_status)')
    .eq('is_primary', true)

  let researched = 0
  for (const m of memberships ?? []) {
    if (researched >= limit) break
    const prod = Array.isArray(m.products) ? m.products[0] : m.products
    if (!prod || (prod as { visibility_status?: string }).visibility_status !== 'visible') continue
    const cat = catBySlug.get(m.category as string)
    if (!cat) continue

    const { count: mc } = await supabase.from('product_mentions').select('id', { count: 'exact', head: true }).eq('product_id', m.product_id)
    if ((mc ?? 0) < minMentions) continue
    // schon mit echten FEATURES recherchiert? Nur dann skippen — Produkte mit bloßer
    // Beschreibung (ohne Feature-Tabelle) sollen die Web-Research nachträglich bekommen.
    const META_DIMS = new Set<string>(['__sentiment', DESCRIPTION_DIM, DESCRIPTION_EN_DIM, RELEASED_DIM])
    if (!force) {
      const { data: existing } = await supabase.from('product_features_current')
        .select('dimension_key').eq('product_id', m.product_id)
      if ((existing ?? []).some((f) => !META_DIMS.has(f.dimension_key as string))) continue
    }

    const dimensions = Array.isArray(cat.feature_dimensions) ? (cat.feature_dimensions as string[]) : []
    // News-Auszüge als zusätzlicher Beleg (die eigentliche Quelle ist die Web-Suche)
    const { data: ments } = await supabase
      .from('product_mentions')
      .select('excerpt')
      .eq('product_id', m.product_id)
      .not('excerpt', 'is', null)
      .order('mention_date', { ascending: false })
      .limit(25)
    const evidence = (ments ?? [])
      .map((x) => (x.excerpt as string)?.trim())
      .filter(Boolean)
      .map((e) => `- ${e}`)
      .join('\n')
      .slice(0, 8000)
    // evidence optional: die Web-Suche ist die Hauptquelle, Belege nur Kontext.
    const res = await researchProduct(
      (prod as { canonical_name: string }).canonical_name, (prod as { vendor_namespace: string }).vendor_namespace,
      cat.name as string, dimensions, evidence,
    )
    if (!res.description && res.features.length === 0) continue

    const rows: Array<Record<string, unknown>> = res.features.map((f) => ({
      product_id: m.product_id, category: m.category, dimension_key: f.dimension,
      value_text: f.value, confidence: 0.85, evidence_count: 1, source_count: 1,
    }))
    if (res.description) rows.push({ product_id: m.product_id, category: m.category, dimension_key: DESCRIPTION_DIM, value_text: res.description, confidence: 0.85, evidence_count: 1, source_count: 1 })
    if (res.descriptionEn) rows.push({ product_id: m.product_id, category: m.category, dimension_key: DESCRIPTION_EN_DIM, value_text: res.descriptionEn, confidence: 0.85, evidence_count: 1, source_count: 1 })
    if (res.releaseDate) rows.push({ product_id: m.product_id, category: m.category, dimension_key: RELEASED_DIM, value_text: res.releaseDate, confidence: 0.85, evidence_count: 1, source_count: 1 })
    // Force: alte Dimensionswerte entfernen, damit nach einer Dimensions-Umstellung
    // keine verwaisten Features (nicht mehr in feature_dimensions) übrig bleiben.
    if (force) {
      await supabase.from('product_features_current').delete().eq('product_id', m.product_id)
        .not('dimension_key', 'in', `(${['__sentiment', DESCRIPTION_DIM, DESCRIPTION_EN_DIM, RELEASED_DIM].join(',')})`)
    }
    const { error } = await supabase.from('product_features_current').upsert(rows, { onConflict: 'product_id,category,dimension_key' })
    if (error) throw new Error(`research upsert: ${error.message}`)
    researched++
  }
  return { researched }
}
