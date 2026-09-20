/**
 * Auswertung von llm_usage für die Admin-Ansicht (/admin/llm-costs).
 *
 * Pur und ohne DB, damit die Rangliste testbar bleibt — die Abfrage selbst
 * steht in app/api/admin/llm-usage/route.ts.
 */
export interface UsageRow {
  created_at: string
  use_case: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_write_tokens: number
  cache_read_tokens: number
  /** null = Modell stand nicht in der Preistabelle (s. lib/ai/usage-cost.ts). */
  cost_usd: number | null
}

interface Bucket {
  calls: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  /** Aufrufe ohne Preis — sonst sähe ein unbekanntes Modell wie "kostenlos" aus. */
  unpricedCalls: number
}

const empty = (): Bucket => ({
  calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, unpricedCalls: 0,
})

function add(b: Bucket, r: UsageRow): void {
  b.calls += 1
  b.costUsd += r.cost_usd ?? 0
  if (r.cost_usd === null || r.cost_usd === undefined) b.unpricedCalls += 1
  b.inputTokens += r.input_tokens ?? 0
  b.outputTokens += r.output_tokens ?? 0
  b.cacheWriteTokens += r.cache_write_tokens ?? 0
  b.cacheReadTokens += r.cache_read_tokens ?? 0
}

function collect<K extends string>(rows: UsageRow[], key: (r: UsageRow) => string) {
  const map = new Map<string, Bucket>()
  for (const r of rows) {
    const k = key(r)
    if (!map.has(k)) map.set(k, empty())
    add(map.get(k)!, r)
  }
  return map
}

export function aggregateUsage(rows: UsageRow[]) {
  const byUseCase = [...collect(rows, (r) => r.use_case)]
    .map(([useCase, b]) => ({ useCase, ...b }))
    .sort((a, b) => b.costUsd - a.costUsd)
  const byModel = [...collect(rows, (r) => r.model)]
    .map(([model, b]) => ({ model, ...b }))
    .sort((a, b) => b.costUsd - a.costUsd)
  const byDay = [...collect(rows, (r) => r.created_at.slice(0, 10))]
    .map(([day, b]) => ({ day, costUsd: b.costUsd, calls: b.calls }))
    .sort((a, b) => a.day.localeCompare(b.day))

  return {
    totalCostUsd: rows.reduce((a, r) => a + (r.cost_usd ?? 0), 0),
    totalCalls: rows.length,
    byUseCase,
    byModel,
    byDay,
  }
}
