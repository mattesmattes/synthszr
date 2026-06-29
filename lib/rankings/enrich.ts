import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'

export interface EnrichableProduct {
  name: string
  vendor: string
}
export interface EnrichedFeature {
  dimension: string
  value: string
  evidence: string | null
}
export interface EnrichResult {
  sentiment: { label: string; score: number } | null
  features: EnrichedFeature[]
}

const SentimentSchema = z.object({ label: z.string().trim().min(1).max(40), score: z.number() })
const FeatureSchema = z.object({
  dimension: z.string(),
  value: z.string().trim().min(1).max(200),
  evidence: z.string().trim().max(400).optional(),
})
const ResponseSchema = z.object({
  sentiment: z.unknown().optional(),
  features: z.array(z.unknown()).optional(),
})

const EMPTY_VALUES = new Set(['unbekannt', 'unknown', 'n/a', 'na', '-', 'keine angabe', 'unclear'])
const LLM_TIMEOUT_MS = 50_000

/** Pure: Enrich-Prompt (Sentiment + Feature-Werte entlang der Kategorie-Dimensionen). */
export function buildEnrichPrompt(product: EnrichableProduct, categoryName: string, dimensions: string[], excerpts: string[]): string {
  const dims = dimensions.map((d) => `- ${d}`).join('\n')
  const ev = excerpts.slice(0, 30).map((e, i) => `${i + 1}. ${e}`).join('\n')
  return `Analysiere AUSSCHLIESSLICH das AI-Produkt "${product.name}" (${product.vendor}, Kategorie: ${categoryName}) anhand der Belege.

1) SENTIMENT: Tonalität der Berichterstattung über DIESES Produkt. label = positiv | gemischt | neutral | negativ, score = -1.0 (sehr negativ) bis 1.0 (sehr positiv).

2) FEATURES: Werte NUR für diese Dimensionen:
${dims}

STRENGE REGELN:
- Nenne ein Feature NUR, wenn ein Beleg den Wert für GENAU dieses Produkt klar aussagt. Im Zweifel: WEGLASSEN. Lieber wenige sichere als viele geratene Features.
- KEINE vagen Werte ("schnelle Adoption", "modern"). KEINE Werte über andere Produkte/Varianten aus den Belegen.
- Jedes Feature MUSS ein wörtliches evidence-Zitat aus den Belegen enthalten, das den Wert belegt.
- dimension EXAKT wie oben geschrieben; value kurz + konkret.

BELEGE:
${ev}`
}

/** Pure: validiert/filtert die LLM-Antwort. Unbekannte Dimensionen + Leerwerte raus. */
export function parseEnrichResponse(raw: unknown, validDimensions: Set<string>): EnrichResult {
  const outer = ResponseSchema.safeParse(raw)
  if (!outer.success) return { sentiment: null, features: [] }

  let sentiment: EnrichResult['sentiment'] = null
  const s = SentimentSchema.safeParse(outer.data.sentiment)
  if (s.success) sentiment = { label: s.data.label, score: Math.max(-1, Math.min(1, s.data.score)) }

  const features: EnrichedFeature[] = []
  const seenDims = new Set<string>()
  for (const f of outer.data.features ?? []) {
    const parsed = FeatureSchema.safeParse(f)
    if (!parsed.success) continue
    if (!validDimensions.has(parsed.data.dimension)) continue
    if (seenDims.has(parsed.data.dimension)) continue // eine pro Dimension (sonst Upsert-Konflikt)
    if (EMPTY_VALUES.has(parsed.data.value.toLowerCase())) continue
    if (!parsed.data.evidence?.trim()) continue // Beleg-Pflicht → keine geratenen Features
    seenDims.add(parsed.data.dimension)
    features.push({ dimension: parsed.data.dimension, value: parsed.data.value, evidence: parsed.data.evidence.trim() })
  }
  return { sentiment, features }
}

/** LLM-Enrichment für ein Produkt. Fehler ⇒ leeres Ergebnis (retrybar). */
export async function enrichProduct(
  product: EnrichableProduct, categoryName: string, dimensions: string[], excerpts: string[],
): Promise<EnrichResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { sentiment: null, features: [] }
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { getModelForUseCase } = await import('@/lib/ai/model-config')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const validDims = new Set(dimensions)
  const tool = {
    name: 'report_analysis',
    description: 'Sentiment + Feature-Werte des Produkts',
    input_schema: {
      type: 'object' as const,
      properties: {
        sentiment: { type: 'object', properties: { label: { type: 'string' }, score: { type: 'number' } }, required: ['label', 'score'] },
        features: {
          type: 'array',
          items: { type: 'object', properties: { dimension: { type: 'string' }, value: { type: 'string' }, evidence: { type: 'string' } }, required: ['dimension', 'value'] },
        },
      },
      required: ['sentiment', 'features'],
    },
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const model = await getModelForUseCase('ranking_extract')
    const resp = await client.messages.create({
      model, max_tokens: 1536, tools: [tool],
      tool_choice: { type: 'tool', name: 'report_analysis' },
      messages: [{ role: 'user', content: buildEnrichPrompt(product, categoryName, dimensions, excerpts) }],
    }, { signal: controller.signal })
    const block = resp.content.find((b) => b.type === 'tool_use')
    return parseEnrichResponse(block && 'input' in block ? block.input : null, validDims)
  } catch {
    return { sentiment: null, features: [] }
  } finally {
    clearTimeout(timer)
  }
}

const SENTIMENT_DIM = '__sentiment'

/**
 * Enricht sichtbare, kategorisierte Produkte mit ≥minMentions Belegen: Sentiment +
 * Features → product_features_current (Sentiment als Pseudo-Dimension __sentiment).
 */
export async function runEnrichment(opts: { minMentions?: number; limit?: number } = {}): Promise<{ enriched: number }> {
  const { minMentions = 2, limit = 200 } = opts
  const supabase = createAdminClient()

  const { data: cats, error: cErr } = await supabase.from('product_categories').select('slug, name, feature_dimensions')
  if (cErr) throw new Error(`categories: ${cErr.message}`)
  const catBySlug = new Map((cats ?? []).map((c) => [c.slug as string, c]))

  // Kategorisierte, sichtbare Produkte (primäre Kategorie)
  const { data: memberships, error: mErr } = await supabase
    .from('product_category_membership')
    .select('product_id, category, products:product_id(canonical_name, vendor_namespace, visibility_status)')
    .eq('is_primary', true)
  if (mErr) throw new Error(`memberships: ${mErr.message}`)

  let enriched = 0
  for (const m of memberships ?? []) {
    if (enriched >= limit) break
    const prod = Array.isArray(m.products) ? m.products[0] : m.products
    if (!prod || (prod as { visibility_status?: string }).visibility_status !== 'visible') continue
    const cat = catBySlug.get(m.category as string)
    if (!cat) continue
    const dimensions = Array.isArray(cat.feature_dimensions) ? (cat.feature_dimensions as string[]) : []

    const { data: mentions } = await supabase
      .from('product_mentions').select('excerpt').eq('product_id', m.product_id).not('excerpt', 'is', null).limit(30)
    const excerpts = (mentions ?? []).map((x) => x.excerpt as string).filter(Boolean)
    if (excerpts.length < minMentions) continue

    const res = await enrichProduct(
      { name: (prod as { canonical_name: string }).canonical_name, vendor: (prod as { vendor_namespace: string }).vendor_namespace },
      cat.name as string, dimensions, excerpts,
    )

    const rows = res.features.map((f) => ({
      product_id: m.product_id, category: m.category, dimension_key: f.dimension,
      value_text: f.value, confidence: 0.5, evidence_count: 1, source_count: 1,
    }))
    if (res.sentiment) {
      rows.push({
        product_id: m.product_id, category: m.category, dimension_key: SENTIMENT_DIM,
        value_text: res.sentiment.label, confidence: 0.5, evidence_count: excerpts.length, source_count: 1,
        // value_numeric separat unten gesetzt
      } as never)
    }
    if (rows.length) {
      // Sentiment-Numeric nachtragen
      const withNumeric = rows.map((r) =>
        r.dimension_key === SENTIMENT_DIM ? { ...r, value_numeric: res.sentiment?.score ?? null } : r,
      )
      const { error } = await supabase.from('product_features_current').upsert(withNumeric, { onConflict: 'product_id,category,dimension_key' })
      if (error) throw new Error(`features upsert: ${error.message}`)
      enriched++
    }
  }
  return { enriched }
}
