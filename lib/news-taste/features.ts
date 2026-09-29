import { evaluateState, JEV_MODEL, type EvaluateAnswer } from '@/lib/ai/evaluate'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  TASTE_QUESTIONS, JEV_FEATURE_NAMES, STORY_TYPE_OPTIONS, FEATURES_VERSION,
} from './questions'

/** Eingabe für State-Bau und Zusatzsignale — Felder kommen 1:1 aus news_queue. */
export interface TasteInput {
  queueItemId: string
  title: string
  source: string | null
  text: string | null
  synthesis: number
  relevance: number
  uniqueness: number
  sourceBonus: number
  sourcePubRate: number
  contentLength: number
}

const MAX_TEXT_CHARS = 1500

/** Der State, den Jev je Artikel sieht. Kompakt: Titel trägt am meisten. */
export function buildTasteState(input: Pick<TasteInput, 'title' | 'source' | 'text'>): string {
  const parts = [`TITLE: ${input.title}`]
  if (input.source) parts.push(`SOURCE: ${input.source}`)
  if (input.text) parts.push(`TEXT: ${input.text.slice(0, MAX_TEXT_CHARS)}`)
  return parts.join('\n')
}

const clamp01 = (n: unknown): number => {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : 0
  return Math.min(1, Math.max(0, x))
}

/**
 * Antworten → deterministischer Feature-Vektor mit EXAKT den
 * JEV_FEATURE_NAMES als Schlüsseln. Fehlende Antworten und unbekannte
 * Optionen werden 0 (nie NaN): der Vektor muss in Training und Runtime
 * identisch entstehen, sonst lernt das Modell Artefakte.
 */
export function answersToVector(answers: Record<string, EvaluateAnswer>): Record<string, number> {
  const v: Record<string, number> = {}
  for (const name of JEV_FEATURE_NAMES) v[name] = 0

  for (const [name, q] of Object.entries(TASTE_QUESTIONS)) {
    const a = answers[name]
    if (!a) continue
    if (q.type === 'boolean' && a.type === 'boolean') {
      // WARUM: Boolean-Wahrscheinlichkeit direkt als Feature (0..1)
      v[name] = clamp01(a.probability)
    } else if (q.type === 'score' && a.type === 'score') {
      // WARUM: Score normiert auf Stufenindex-Bereich 0..levels-1 → 0..1
      // z.B. 5 Stufen → Index 0,1,2,3,4 → Normierung auf 0..4 → a.score / (levels - 1)
      const levels = q.criteria.length
      v[name] = clamp01(a.score / (levels - 1))
      // WARUM: Streuung der Wahrscheinlichkeitsverteilung als zweites Feature
      v[`${name}_spread`] = spreadOf(a.probabilities)
    } else if (q.type === 'choice' && a.type === 'choice') {
      // WARUM: Soft one-hot für jede Option (probabilistische Version)
      for (const opt of STORY_TYPE_OPTIONS) {
        v[`story_${opt}`] = clamp01(a.probabilities?.[opt] ?? (a.choice === opt ? 1 : 0))
      }
    }
  }
  return v
}

/** Streuung einer Stufen-Verteilung (Std-Abw. im 0..1-normierten Indexraum). */
function spreadOf(probs: number[] | Record<string, number> | undefined): number {
  // WARUM: Array-Form (aus Tests) und Record-Form (live-Format) beide unterstützen
  const arr = Array.isArray(probs) ? probs : probs ? Object.values(probs) : []
  if (arr.length < 2) return 0
  const denom = arr.length - 1
  let mean = 0
  arr.forEach((p, i) => { mean += clamp01(p) * (i / denom) })
  let variance = 0
  arr.forEach((p, i) => { variance += clamp01(p) * (i / denom - mean) ** 2 })
  return Math.sqrt(variance)
}

/** Zusatzsignale aus news_queue — kosten nichts, kommen NICHT von Jev. */
export function extraFeatures(input: TasteInput): Record<string, number> {
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)
  return {
    synthesis_score: num(input.synthesis),
    relevance_score: num(input.relevance),
    uniqueness_score: num(input.uniqueness),
    source_bonus: num(input.sourceBonus),
    source_pub_rate: num(input.sourcePubRate),
    // WARUM: Log-Skalierung der Länge, da exponentielles Wachstum weniger interpretierbar ist
    log_content_length: Math.log10(Math.max(0, num(input.contentLength)) + 1),
  }
}

const IN_CHUNK = 200 // Supabase-.in()-Listen klein halten

/**
 * Liefert Jev-Feature-Vektoren für die Items: erst Lookup in
 * news_taste_features (NUR aktuelle FEATURES_VERSION — alte Kataloge
 * erzeugen andere Vektoren), fehlende werden live berechnet und persistiert.
 * Fehler einzelner Items landen in failedIds; der Aufrufer entscheidet über
 * Fallback (Runtime) oder Protokoll (Backfill).
 */
export async function getOrComputeFeatures(
  items: TasteInput[],
  opts: { concurrency?: number } = {},
): Promise<{ features: Map<string, Record<string, number>>; failedIds: string[] }> {
  const supabase = createAdminClient()
  const features = new Map<string, Record<string, number>>()
  const failedIds: string[] = []

  const ids = items.map((i) => i.queueItemId)
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from('news_taste_features')
      .select('queue_item_id, features')
      .eq('features_version', FEATURES_VERSION)
      .in('queue_item_id', ids.slice(i, i + IN_CHUNK))
    if (error) throw new Error(`Feature-Lookup fehlgeschlagen: ${error.message}`)
    for (const row of data ?? []) {
      features.set(row.queue_item_id as string, row.features as Record<string, number>)
    }
  }

  const missing = items.filter((i) => !features.has(i.queueItemId))
  if (missing.length === 0) return { features, failedIds }

  // WARUM: Handgerollter Semaphor statt p-limit: eine Abhängigkeit weniger.
  const concurrency = Math.max(1, opts.concurrency ?? 10)
  let cursor = 0
  const worker = async () => {
    for (;;) {
      const idx = cursor++
      if (idx >= missing.length) return
      const item = missing[idx]
      try {
        const res = await evaluateState(buildTasteState(item), TASTE_QUESTIONS)
        const vector = answersToVector(res.answers)
        features.set(item.queueItemId, vector)
        const { error } = await supabase.from('news_taste_features').upsert({
          queue_item_id: item.queueItemId,
          features_version: FEATURES_VERSION,
          features: vector,
          model: JEV_MODEL,
          input_tokens: res.usage.inputTokens,
        }, { onConflict: 'queue_item_id,features_version' })
        if (error) console.warn('[NewsTaste] Vektor nicht gespeichert:', item.queueItemId, error.message)
      } catch (err) {
        console.warn('[NewsTaste] Features fehlgeschlagen:', item.queueItemId,
          err instanceof Error ? err.message : err)
        failedIds.push(item.queueItemId)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, worker))
  return { features, failedIds }
}
