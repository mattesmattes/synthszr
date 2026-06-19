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
import { createAdminClient } from '@/lib/supabase/admin'
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

/** Why an item was dropped: another item in the same batch, or already covered. */
export type DropReason = 'batch' | 'recent_coverage'

export interface DropRecord {
  id: string
  title: string
  similarTo: string   // kept item's id (batch) or recent-coverage title
  similarity: number
  reason: DropReason
}

export interface CoverageItem {
  title: string
  embedding: number[]
}

export interface DedupResult<T> {
  kept: T[]
  dropped: DropRecord[]
}

/**
 * Pure greedy clustering. Items must be pre-sorted best-first; the first item of
 * each topic cluster is kept, later near-duplicates are dropped. `embeddings` is
 * parallel to `items`. An item with a missing/empty embedding is always kept
 * (we cannot judge similarity for it).
 *
 * `prior` holds embeddings of news already covered in recently published posts —
 * an item matching any of those is dropped as 'recent_coverage' (checked BEFORE
 * the in-batch comparison, so cross-day repeats are reported as such). Exported
 * for unit testing.
 */
export function clusterByEmbedding<T extends { id: string; title: string }>(
  items: T[],
  embeddings: number[][],
  threshold: number,
  prior: CoverageItem[] = []
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

    // 1. Already covered in the last N days?
    let coverIdx = -1
    let coverSim = 0
    for (let p = 0; p < prior.length; p++) {
      if (!prior[p].embedding?.length) continue
      const sim = cosineSimilarity(embedding, prior[p].embedding)
      if (sim >= threshold && sim > coverSim) {
        coverSim = sim
        coverIdx = p
      }
    }
    if (coverIdx >= 0) {
      dropped.push({ id: items[i].id, title: items[i].title, similarTo: prior[coverIdx].title, similarity: coverSim, reason: 'recent_coverage' })
      continue
    }

    // 2. Duplicate of an item already kept this batch?
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
      dropped.push({ id: items[i].id, title: items[i].title, similarTo: kept[dupIdx].id, similarity: bestSim, reason: 'batch' })
    } else {
      kept.push(items[i])
      keptEmbeddings.push(embedding)
    }
  }

  return { kept, dropped }
}

/** A pgvector column arrives from PostgREST as a JSON string or a number[]. */
function parseEmbedding(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw as number[]
  if (typeof raw === 'string') {
    try {
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * Embeddings of news already covered in posts PUBLISHED in the last `days` days.
 * Signal: news_queue items marked status='used' whose post is published & recent
 * (set together by markItemsAsUsed). Their daily_repo embeddings were backfilled
 * by now, so they're directly comparable to the on-the-fly candidate embeddings.
 */
export async function getRecentCoverageEmbeddings(days: number = 3): Promise<CoverageItem[]> {
  const supabase = createAdminClient()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const { data: posts } = await supabase
    .from('generated_posts')
    .select('id')
    .eq('status', 'published')
    .gte('created_at', since)
  const postIds = (posts ?? []).map(p => p.id)
  if (postIds.length === 0) return []

  const { data: items } = await supabase
    .from('news_queue')
    .select('title, daily_repo_id')
    .in('used_in_post_id', postIds)
    .not('daily_repo_id', 'is', null)
  const repoIds = [...new Set((items ?? []).map(i => i.daily_repo_id as string))]
  if (repoIds.length === 0) return []

  const { data: repo } = await supabase
    .from('daily_repo')
    .select('id, embedding')
    .in('id', repoIds)
    .not('embedding', 'is', null)
  const embById = new Map((repo ?? []).map(r => [r.id, parseEmbedding(r.embedding)]))

  const coverage: CoverageItem[] = []
  for (const it of items ?? []) {
    const emb = embById.get(it.daily_repo_id as string)
    if (emb && emb.length > 0) coverage.push({ title: it.title, embedding: emb })
  }
  return coverage
}

/**
 * Embeds the candidate items (title+content) and greedily drops near-duplicate
 * topics, keeping the highest-scored item per topic. Caller need not pre-sort —
 * we sort by total_score desc here.
 *
 * When `recentCoverageDays > 0`, also drops candidates that repeat news already
 * covered in posts published within that window. If embedding generation fails,
 * returns the input unchanged (dedup is best-effort, never blocks generation).
 */
export async function dedupeByTopic<T extends DedupItem>(
  items: T[],
  opts: { threshold?: number; recentCoverageDays?: number } = {}
): Promise<DedupResult<T>> {
  const { threshold = DEFAULT_DEDUP_THRESHOLD, recentCoverageDays = 0 } = opts
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

  let prior: CoverageItem[] = []
  if (recentCoverageDays > 0) {
    try {
      prior = await getRecentCoverageEmbeddings(recentCoverageDays)
      console.log(`[SemanticDedup] loaded ${prior.length} recent-coverage embeddings (${recentCoverageDays}d)`)
    } catch (err) {
      console.error('[SemanticDedup] recent-coverage fetch failed, batch-only dedup:', err)
    }
  }

  return clusterByEmbedding(ordered, embeddings, threshold, prior)
}
