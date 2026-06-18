/**
 * Semantic topic deduplication for the article-selection step.
 *
 * Problem it solves: the same news event is reported by several sources with
 * completely different headlines ("raised over $7.4 billion" vs. "DeepSeek's
 * $7.4B Round: Founder Control at $50B Valuation"). The synthesis pipeline only
 * dedupes on title-bigram Jaccard, which scores those near 0 — so all of them
 * end up in the same auto-generated article. Embedding cosine similarity catches
 * them (empirically 0.80–0.96 for same-event items).
 *
 * Fresh queue items are NOT pre-embedded (daily_repo.embedding is backfilled
 * later), so we generate embeddings on the fly from title+content at selection
 * time. ~40–64 embedding calls, a few seconds — well within the cron budget.
 */
import { generateEmbeddings, prepareTextForEmbedding, cosineSimilarity } from '@/lib/embeddings/generator'

/** Cosine-similarity threshold above which two items count as the same topic. */
export const DEFAULT_DEDUP_THRESHOLD = 0.8

export interface DedupItem {
  id: string
  title: string
  content?: string | null
  source_identifier?: string
  total_score?: number
}

export interface DropRecord {
  id: string
  title: string
  similarTo: string
  similarity: number
}

export interface DedupResult<T> {
  kept: T[]
  dropped: DropRecord[]
}

/**
 * Pure greedy clustering. Items must be pre-sorted best-first; the first item of
 * each topic cluster is kept, later near-duplicates are dropped. `embeddings` is
 * parallel to `items`. An item with a missing/empty embedding is always kept
 * (we cannot judge similarity for it). Exported for unit testing.
 */
export function clusterByEmbedding<T extends { id: string; title: string }>(
  items: T[],
  embeddings: number[][],
  threshold: number
): DedupResult<T> {
  const kept: T[] = []
  const keptEmbeddings: number[][] = []
  const dropped: DropRecord[] = []

  for (let i = 0; i < items.length; i++) {
    const embedding = embeddings[i]

    if (!embedding || embedding.length === 0) {
      kept.push(items[i])
      keptEmbeddings.push([])
      continue
    }

    let dupIdx = -1
    let bestSim = 0
    for (let k = 0; k < kept.length; k++) {
      if (keptEmbeddings[k].length === 0) continue
      const sim = cosineSimilarity(embedding, keptEmbeddings[k])
      if (sim >= threshold && sim > bestSim) {
        bestSim = sim
        dupIdx = k
      }
    }

    if (dupIdx >= 0) {
      dropped.push({ id: items[i].id, title: items[i].title, similarTo: kept[dupIdx].id, similarity: bestSim })
    } else {
      kept.push(items[i])
      keptEmbeddings.push(embedding)
    }
  }

  return { kept, dropped }
}

/**
 * Embeds the candidate items (title+content) and greedily drops near-duplicate
 * topics, keeping the highest-scored item per topic. Caller need not pre-sort —
 * we sort by total_score desc here. If embedding generation fails, returns the
 * input unchanged (dedup is best-effort, never blocks article generation).
 */
export async function dedupeByTopic<T extends DedupItem>(
  items: T[],
  threshold: number = DEFAULT_DEDUP_THRESHOLD
): Promise<DedupResult<T>> {
  if (items.length <= 1) return { kept: items, dropped: [] }

  const ordered = [...items].sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0))
  const texts = ordered.map(i =>
    prepareTextForEmbedding(i.title, i.content ?? '', { includeSource: i.source_identifier })
  )

  let embeddings: number[][]
  try {
    embeddings = await generateEmbeddings(texts, { batchSize: 16 })
  } catch (err) {
    console.error('[SemanticDedup] embedding generation failed, skipping dedup:', err)
    return { kept: items, dropped: [] }
  }

  return clusterByEmbedding(ordered, embeddings, threshold)
}
