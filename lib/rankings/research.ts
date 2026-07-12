import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { DIMENSION_EN } from '@/lib/rankings/dimension-i18n'

export interface ResearchedFeature { dimension: string; value: string; valueEn?: string }
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

// KEINE .max()-Caps im Schema: ein überlanges Feld darf NICHT den ganzen Parse (bzw. beim
// Feature das ganze Item) verwerfen. Überlängen werden beim Auslesen gekürzt (siehe unten).
// Historie: release_date.max(40) ließ ReportSchema hart fehlschlagen → verwarf sämtliche
// Features großer Produkte (komplexe Release-Historie "Preview … GA …" > 40 Zeichen).
const MAX_VALUE = 500 // Spec-Werte: Preis-Staffeln/Benchmark-Details laufen bis ~450 Zeichen
const MAX_DESC = 800
const MAX_RELEASE = 120
const FeatureSchema = z.object({ dimension: z.string(), value: z.string().trim().min(1), value_en: z.string().trim().optional(), source_url: z.string().trim().optional() })
const ReportSchema = z.object({
  description: z.string().trim().optional(),
  description_en: z.string().trim().optional(),
  release_date: z.string().trim().optional(),
  features: z.array(z.unknown()).optional(),
})
const EMPTY = new Set(['unbekannt', 'unknown', 'n/a', 'na', '-', 'keine angabe'])

/** Entfernt web_search-Citation-Markup (<cite …>…</cite>) und kappt geleaktes
 *  Tool-Call-Markup (</description>, <parameter …> …) — Claude schreibt bei
 *  Tool-Fehlern gelegentlich das rohe Call-XML in die Feldwerte. */
function stripCite(s: string): string {
  return s
    .replace(/<\/?cite[^>]*>/g, '')
    .replace(/<\/?(?:description(?:_en)?|parameter)\b[^>]*>[\s\S]*/i, '')
    .trim()
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
    const value = stripCite(p.data.value).slice(0, MAX_VALUE)
    if (!value) continue
    const valueEn = p.data.value_en ? stripCite(p.data.value_en).slice(0, MAX_VALUE) || undefined : undefined
    seen.add(p.data.dimension)
    features.push({ dimension: p.data.dimension, value, valueEn })
  }
  return {
    description: outer.data.description ? stripCite(outer.data.description).slice(0, MAX_DESC) || null : null,
    descriptionEn: outer.data.description_en ? stripCite(outer.data.description_en).slice(0, MAX_DESC) || null : null,
    releaseDate: outer.data.release_date ? stripCite(outer.data.release_date).slice(0, MAX_RELEASE) || null : null,
    features,
  }
}

const RESEARCH_TIMEOUT_MS = 240_000 // große Produkte (viel Web-Content) brauchen mehr web_search-Zeit
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
            value_en: { type: 'string', description: 'Derselbe Wert auf Englisch (knapp, tabellentauglich)' },
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

/** DE→EN-Fallback für die Produktbeschreibung. description_en ist im REPORT_TOOL zwar
 *  required, aber ohne strict:true erzwingt die API das nicht — Sonnet lässt es
 *  gelegentlich weg, dann zeigt /en den deutschen Text. Dieser deterministische
 *  Haiku-Call garantiert eine englische Beschreibung. Best-effort (null bei Fehler). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function translateDescriptionToEnglish(client: any, textDe: string): Promise<string | null> {
  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 600,
      messages: [{ role: 'user', content: `Translate this German AI-product description into natural, concise English. Keep technical terms (Token, Reasoning, Inference, Fine-Tuning, Open Source, Benchmark) and product/company names unchanged. Return ONLY the English translation, no preamble:\n\n${textDe}` }],
    })
    for (const b of resp.content) if (b.type === 'text') return (b.text as string).trim() || null
    return null
  } catch (e) {
    console.error('[research-translate]', e instanceof Error ? e.message : e)
    return null
  }
}

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
VORGEHEN — OFFIZIELLE PRODUKTSEITE ZUERST: Finde zuerst die offizielle Website/Produktseite von "${name}" SELBST (z.B. per Suche "${name} official site" / "${name} pricing" / "${name} docs"). WICHTIG: Die Produkt-Domain weicht oft vom Konzern-Anbieter ab — das Produkt gehört zwar zu "${vendor}", liegt aber häufig auf einer EIGENEN Domain (Beispiel: ein Kuaishou-Videoprodukt liegt auf klingai.com, nicht kuaishou.com). Suche also nach der Produkt-Domain, nicht nur nach dem Anbieter-Konzern. Entnimm die Specs PRIMÄR von dieser offiziellen Produktseite — Produkt-/Preis-Seite, Doku, Release-Notes, Modell-Karte, Blog-Announcement. Das ist die autoritative Quelle und liefert die meisten Werte. Nur wenn ein Wert dort fehlt, ergänze mit seriösen Tech-Quellen/Benchmark-Listen. Rufe dann report_research:
1. description: 2-4 nüchterne Sätze DEUTSCH (kein Marketing).
2. description_en: dieselbe Aussage ENGLISCH.
3. release_date: Erscheinungsdatum, falls in einer Quelle belegt.
4. features: für JEDE dieser Dimensionen (dimension EXAKT wie unten) den belegten Wert MIT source_url. Gib value (Deutsch) UND value_en (dieselbe Info Englisch, gleiche Konvention: $1.25, 1,000, January 2025). Halte jeden Wert KNAPP und tabellentauglich (kein Fließtext, keine Aufzählung ganzer Historien — nur der aktuelle Kernwert, idealerweise < 200 Zeichen):
${dims}

STRIKT — KEIN SPEKULIEREN:
- Gib einen feature-Wert NUR an, wenn du ihn in einer konkreten Web-Quelle gefunden hast, und trage die belegende source_url ein.
- Findest du einen Wert nicht belegt, LASS die Dimension WEG. Niemals schätzen, raten oder aus Allgemeinwissen ergänzen.
- Alle Daten existieren im Netz — suche gründlich (mehrere Suchanfragen), bevor du eine Dimension auslässt.`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS)
  try {
    const resp = await client.messages.create({
      // Sonnet 5: stärkeres Instruction-Following (hilft Citation-/Produkt-Domain-Prompt);
      // thinking explizit AUS (auf Sonnet 5 sonst adaptiv default an) — reine Web-Extraktion
      // braucht kein Reasoning, so bleiben Kosten/Latenz vorhersehbar.
      model: 'claude-sonnet-5', max_tokens: 4000,
      thinking: { type: 'disabled' },
      tools: [REPORT_TOOL, { type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
      messages: [{ role: 'user', content: prompt }],
    }, { signal: controller.signal })
    const block = [...resp.content].reverse().find((b: { type: string; name?: string }) => b.type === 'tool_use' && b.name === 'report_research')
    const result = parseResearchResponse(block && 'input' in block ? block.input : null, new Set(dimensions))
    // description_en fehlt trotz required (ohne strict) gelegentlich → DE→EN-Fallback,
    // damit /en nie den deutschen Beschreibungstext zeigt.
    if (result.description && !result.descriptionEn) {
      result.descriptionEn = await translateDescriptionToEnglish(client, result.description)
    }
    return result
  } catch (e) {
    // Fehler NICHT verschlucken: Timeout/Overload sonst ununterscheidbar von "leer".
    console.error(`[research-error] ${name}:`, e instanceof Error ? `${e.name}: ${e.message}` : e)
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
  opts: { limit?: number; minMentions?: number; force?: boolean; concurrency?: number; budgetMs?: number; onProgress?: (researched: number, attempted: number) => void } = {},
): Promise<{ researched: number }> {
  const { limit = 60, minMentions = 2, force = false, concurrency = 1, budgetMs, onProgress } = opts
  const startedAt = Date.now()
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

  // Prominenteste zuerst: nach precompute sind product_metrics.mention_count frisch.
  // Ohne diese Sortierung liefe die Research in DB-Reihenfolge und ließe frisch
  // aufgestiegene, hoch-erwähnte Produkte (neue Meta-/OpenAI-Modelle o.ä.) im
  // Rückstand — genau die, deren fehlende Beschreibung am sichtbarsten ist.
  const mentionByProduct = new Map<string, number>()
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.from('product_metrics').select('product_id, mention_count').range(off, off + 999)
    if (!data?.length) break
    for (const r of data) mentionByProduct.set(r.product_id as string, (r.mention_count as number) ?? 0)
    if (data.length < 1000) break
  }
  memberships.sort((a, b) => (mentionByProduct.get(b.product_id) ?? 0) - (mentionByProduct.get(a.product_id) ?? 0))

  /** Recherchiert + schreibt EIN Produkt. Rückgabe: true bei geschriebenem Ergebnis. */
  const researchOne = async (m: Membership): Promise<boolean> => {
    const prod = Array.isArray(m.products) ? m.products[0] : m.products
    if (!prod || (prod as { visibility_status?: string }).visibility_status !== 'visible') return false
    const cat = catBySlug.get(m.category)
    if (!cat) return false

    const { count: mc } = await supabase.from('product_mentions').select('id', { count: 'exact', head: true }).eq('product_id', m.product_id)
    if ((mc ?? 0) < minMentions) return false

    const dimensions = Array.isArray(cat.feature_dimensions) ? (cat.feature_dimensions as string[]) : []
    if (!force) {
      // Skip nur, wenn bereits per Web-Research ANGEFRAGT (Marker gesetzt) ODER AUSREICHEND
      // gefüllt (≥ Hälfte der Kategorie-Dimensionen). Teilgefüllte Produkte OHNE Marker
      // (Alt-Daten aus dem News-Enrich, das oft nur 1 Spec fand) bekommen EINEN Nachschlag —
      // die Research schreibt den Marker danach IMMER, also kein tägliches Neu-Anfragen.
      const { data: existing } = await supabase.from('product_features_current')
        .select('dimension_key').eq('product_id', m.product_id)
      const keys = (existing ?? []).map((f) => f.dimension_key as string)
      const realCount = keys.filter((k) => !META_DIMS.has(k)).length
      const enough = dimensions.length > 0 && realCount >= Math.ceil(dimensions.length / 2)
      if (keys.includes(RESEARCHED_AT_DIM) || enough) return false
    }
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
      dimension_key_en: DIMENSION_EN[f.dimension] ?? f.dimension,
      value_text: f.value, value_text_en: f.valueEn ?? null,
      confidence: 0.85, evidence_count: 1, source_count: 1,
    }))
    if (res.description) rows.push({ product_id: m.product_id, category: m.category, dimension_key: DESCRIPTION_DIM, value_text: res.description, confidence: 0.85, evidence_count: 1, source_count: 1 })
    if (res.descriptionEn) rows.push({ product_id: m.product_id, category: m.category, dimension_key: DESCRIPTION_EN_DIM, value_text: res.descriptionEn, confidence: 0.85, evidence_count: 1, source_count: 1 })
    if (res.releaseDate) rows.push({ product_id: m.product_id, category: m.category, dimension_key: RELEASED_DIM, value_text: res.releaseDate, confidence: 0.85, evidence_count: 1, source_count: 1 })
    // Marker IMMER schreiben (auch bei Leer-Ergebnis) → force=false fragt dieses Produkt
    // nicht erneut an (keine täglichen Retry-Kosten für Produkte ohne Web-Daten).
    rows.push({ product_id: m.product_id, category: m.category, dimension_key: RESEARCHED_AT_DIM, value_text: new Date().toISOString(), confidence: 1, evidence_count: 0, source_count: 0 })
    // Force: alte Dimensionswerte entfernen, damit nach einer Dimensions-Umstellung keine
    // verwaisten Features übrig bleiben — ABER NUR wenn die Research neue Features lieferte.
    // Sonst würde ein leeres Ergebnis (API-Fehler/Rate-Limit) die alten Specs zerstören.
    if (force && res.features.length > 0) {
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
    while (researched < limit && idx < memberships.length && (!budgetMs || Date.now() - startedAt < budgetMs)) {
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
