// lib/news-queue/metrics.ts

/** Recall@K: fraction of the relevant set that appears in the top-K ranking. */
export function recallAtK(ranked: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0
  const topK = ranked.slice(0, k)
  let hits = 0
  for (const id of topK) if (relevant.has(id)) hits++
  return hits / relevant.size
}

/** NDCG@K with binary relevance. */
export function ndcgAtK(ranked: string[], relevant: Set<string>, k: number): number {
  const topK = ranked.slice(0, k)
  let dcg = 0
  topK.forEach((id, i) => {
    if (relevant.has(id)) dcg += 1 / Math.log2(i + 2)
  })
  const idealHits = Math.min(relevant.size, k)
  let idcg = 0
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2)
  return idcg === 0 ? 0 : dcg / idcg
}
