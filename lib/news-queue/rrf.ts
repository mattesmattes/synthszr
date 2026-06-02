// lib/news-queue/rrf.ts

/**
 * Reciprocal Rank Fusion. Each input list is an ordered array of ids (best first).
 * Score(id) = Σ 1/(k + rank_i), rank starting at 1. Returns ids sorted by score desc.
 */
export function reciprocalRankFusion(rankings: string[][], k = 60): string[] {
  const scores = new Map<string, number>()
  for (const list of rankings) {
    list.forEach((id, idx) => {
      const rank = idx + 1
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank))
    })
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}
