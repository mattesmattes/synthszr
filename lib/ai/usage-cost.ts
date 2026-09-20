import { MODEL_PRICING } from '@/lib/ai/model-pricing'

/**
 * Token-Verbrauch eines Modellaufrufs, normalisiert auf die vier Posten, die
 * Anthropic getrennt abrechnet.
 *
 * `outputTokens` enthält bereits die Thinking-Token — die API zählt sie dort
 * mit, und sie kosten den Output-Preis. Bei Opus 5 mit effort:high ist das der
 * größte Posten überhaupt (Befund 2026-09-20).
 */
export interface UsageTokens {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
}

/** Preisfaktoren relativ zum Input-Preis (Anthropic, 5-Minuten-Cache). */
const CACHE_WRITE_FACTOR = 1.25
const CACHE_READ_FACTOR = 0.1

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Liest das `usage`-Objekt einer Anthropic-Antwort. null = kein usage dabei. */
export function extractUsage(raw: unknown): UsageTokens | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheWriteTokens: num(u.cache_creation_input_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
  }
}

/**
 * Kosten eines Aufrufs in USD. null = Modell steht nicht in der Preistabelle
 * (lib/ai/model-pricing.ts) — dann werden die Token trotzdem protokolliert,
 * nur eben ohne Preis. Lieber eine sichtbare Lücke als eine erfundene 0.
 */
export function computeCostUsd(model: string, tokens: UsageTokens): number | null {
  const pricing = MODEL_PRICING[model]?.pricing
  if (!pricing) return null
  const perInputToken = pricing.input / 1_000_000
  return (
    tokens.inputTokens * perInputToken +
    tokens.outputTokens * (pricing.output / 1_000_000) +
    tokens.cacheWriteTokens * perInputToken * CACHE_WRITE_FACTOR +
    tokens.cacheReadTokens * perInputToken * CACHE_READ_FACTOR
  )
}
