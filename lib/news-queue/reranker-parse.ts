import type { RankedSuggestion } from './ranking-types'

/**
 * Parse the reranker's JSON output. Extracts the first JSON array found,
 * keeps only entries whose queueItemId is in `validIds`, dedupes, and
 * sorts by ascending rank. Never throws — returns [] on any problem.
 */
export function parseRerankerResponse(text: string, validIds: Set<string>): RankedSuggestion[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  let raw: unknown
  try {
    raw = JSON.parse(match[0])
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  const seen = new Set<string>()
  const out: RankedSuggestion[] = []
  for (const entry of raw) {
    const e = entry as Partial<RankedSuggestion>
    const id = typeof e.queueItemId === 'string' ? e.queueItemId : null
    if (!id || !validIds.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push({
      queueItemId: id,
      rank: typeof e.rank === 'number' ? e.rank : out.length + 1,
      reason: typeof e.reason === 'string' ? e.reason : '',
      confidence: typeof e.confidence === 'number' ? e.confidence : 0.5,
    })
  }
  return out.sort((a, b) => a.rank - b.rank)
}
