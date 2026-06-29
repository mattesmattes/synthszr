import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'

export interface ResearchedFeature { dimension: string; value: string }
export interface ResearchResult {
  description: string | null
  releaseDate: string | null
  features: ResearchedFeature[]
}

export const DESCRIPTION_DIM = '__description'
export const RELEASED_DIM = '__released'

const FeatureSchema = z.object({ dimension: z.string(), value: z.string().trim().min(1).max(200) })
const ReportSchema = z.object({
  description: z.string().trim().max(800).optional(),
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
  if (!outer.success) return { description: null, releaseDate: null, features: [] }
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
    releaseDate: outer.data.release_date?.trim() || null,
    features,
  }
}

/** Fasst ein Produkt AUS DEN NEWS-BELEGEN zusammen → Beschreibung + Release +
 *  Spec-Werte. Keine Web-Suche: für synthszr-Produkte (die es real nicht gibt)
 *  halluziniert web_search, deshalb ausschließlich die Newsletter-Auszüge als Quelle. */
export async function researchProduct(
  name: string, vendor: string, categoryName: string, dimensions: string[], evidence: string,
): Promise<ResearchResult> {
  if (!process.env.ANTHROPIC_API_KEY || !evidence.trim()) return { description: null, releaseDate: null, features: [] }
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const report = {
    name: 'report_research',
    description: 'Melde die aus den Belegen zusammengefassten Produktdaten',
    input_schema: {
      type: 'object' as const,
      properties: {
        description: { type: 'string' },
        release_date: { type: 'string' },
        features: { type: 'array', items: { type: 'object', properties: { dimension: { type: 'string' }, value: { type: 'string' } }, required: ['dimension', 'value'] } },
      },
      required: ['description', 'features'],
    },
  }
  const dims = dimensions.map((d) => `- ${d}`).join('\n')
  const prompt = `Hier sind Auszüge aus AI-Newsletter-Artikeln, die das Produkt "${name}" von ${vendor} (Kategorie: ${categoryName}) erwähnen:

${evidence}

Erstelle AUSSCHLIESSLICH auf Basis dieser Auszüge (erfinde NICHTS — keine Zahlen, Specs oder Eigenschaften, die nicht ausdrücklich in den Auszügen stehen):
1. description: 2-4 nüchterne Sätze, was das Produkt laut den Auszügen ist und was es besonders macht. Kein Marketing-Sprech.
2. release_date: nur wenn in den Auszügen genannt (z.B. "Juni 2026").
3. features: konkrete Werte NUR für diese Dimensionen und NUR wenn in den Auszügen belegt (sonst weglassen):
${dims}
   dimension EXAKT wie oben, value kurz + konkret.

Wenn die Auszüge zu wenig hergeben, lass description leer und features weg. Lieber leer als erfunden.`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1200,
      tools: [report],
      tool_choice: { type: 'tool', name: 'report_research' },
      messages: [{ role: 'user', content: prompt }],
    }, { signal: controller.signal })
    const block = resp.content.find((b) => b.type === 'tool_use' && b.name === 'report_research')
    return parseResearchResponse(block && 'input' in block ? block.input : null, new Set(dimensions))
  } catch {
    return { description: null, releaseDate: null, features: [] }
  } finally {
    clearTimeout(timer)
  }
}

/** Recherchiert sichtbare, kategorisierte Produkte (Top nach Mentions) und schreibt
 *  Beschreibung/Release/Specs nach product_features_current (source research). */
export async function runProductResearch(opts: { limit?: number; minMentions?: number } = {}): Promise<{ researched: number }> {
  const { limit = 60, minMentions = 2 } = opts
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
    // schon recherchiert? (description vorhanden)
    const { data: existing } = await supabase.from('product_features_current')
      .select('dimension_key').eq('product_id', m.product_id).eq('dimension_key', DESCRIPTION_DIM).maybeSingle()
    if (existing) continue

    const dimensions = Array.isArray(cat.feature_dimensions) ? (cat.feature_dimensions as string[]) : []
    // News-Auszüge als ALLEINIGE Quelle (keine Web-Suche → keine Halluzination)
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
    if (!evidence.trim()) continue
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
    if (res.releaseDate) rows.push({ product_id: m.product_id, category: m.category, dimension_key: RELEASED_DIM, value_text: res.releaseDate, confidence: 0.85, evidence_count: 1, source_count: 1 })
    const { error } = await supabase.from('product_features_current').upsert(rows, { onConflict: 'product_id,category,dimension_key' })
    if (error) throw new Error(`research upsert: ${error.message}`)
    researched++
  }
  return { researched }
}
