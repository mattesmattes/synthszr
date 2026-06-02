// lib/news-queue/ranking-service.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { isJunkTitle } from './service'
import { reciprocalRankFusion } from './rrf'
import { getWinnerSimilarity } from './winner-similarity'
import { runReranker } from './reranker'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { createRun, recordSuggestions, getRecentLabels } from './suggestions'
import type { RankingCandidate, RankedSuggestion } from './ranking-types'

// Decided empirically by `npx tsx scripts/eval-ranking.ts --stage1`:
// RRF Recall@80 = 0.556 (< 0.7 threshold) → do NOT prefilter; rerank the whole
// recent candidate pool with the LLM.
const DEFAULT_STAGE1: 'rrf' | 'all' = 'all'
const STAGE1_TOPK = 80
const MAX_FOR_ALL = 200
const RECENCY_HOURS = 48
const TARGET = 15

export interface RankingResult {
  runId: string
  suggestions: Array<RankedSuggestion & { title: string; source: string | null }>
}

export async function generateRankingSuggestions(
  stage1: 'rrf' | 'all' = DEFAULT_STAGE1
): Promise<RankingResult> {
  const supabase = createAdminClient()

  // Recent pending candidates only — matches the daily curation workflow
  // (~150/day inflow) rather than the full unexpired backlog (~1000+ items).
  const since = new Date(Date.now() - RECENCY_HOURS * 3600 * 1000).toISOString()
  const { data: rows } = await supabase
    .from('news_queue')
    .select('id, title, excerpt, source_display_name, total_score')
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .gte('queued_at', since)
    .order('total_score', { ascending: false })
    .limit(300)

  const cleaned = (rows || []).filter((r) => !isJunkTitle(r.title))
  const candidateIds = cleaned.map((r) => r.id as string)
  const simMap = await getWinnerSimilarity(candidateIds)

  const byId = new Map<string, RankingCandidate>()
  for (const r of cleaned) {
    byId.set(r.id, {
      queueItemId: r.id,
      title: r.title,
      excerpt: r.excerpt,
      source: r.source_display_name,
      totalScore: Number(r.total_score) || 0,
      winnerSimilarity: simMap.get(r.id) ?? 0,
    })
  }

  // Stage 1: select the pool the reranker sees.
  let pool: RankingCandidate[]
  if (stage1 === 'all') {
    pool = cleaned.slice(0, MAX_FOR_ALL).map((r) => byId.get(r.id)!)
  } else {
    const scoreRank = candidateIds // total_score DESC already
    const simRank = [...candidateIds].sort((a, b) => (simMap.get(b) ?? 0) - (simMap.get(a) ?? 0))
    const fused = reciprocalRankFusion([scoreRank, simRank], 60).slice(0, STAGE1_TOPK)
    pool = fused.map((id) => byId.get(id)!).filter(Boolean)
  }

  // No candidates in the recency window → nothing to rank. Skip the LLM call
  // and avoid persisting an orphan empty run.
  if (pool.length === 0) {
    return { runId: '', suggestions: [] }
  }

  // Stage 2: rerank.
  const { positives, negatives } = await getRecentLabels(15)
  const suggestions = await runReranker(pool, positives, negatives, TARGET)

  // Persist.
  const model = await getModelForUseCase('queue_ranking')
  const runId = await createRun({
    candidateCount: pool.length,
    suggestedCount: suggestions.length,
    stage1Method: stage1,
    model,
  })
  await recordSuggestions(runId, suggestions)

  return {
    runId,
    suggestions: suggestions.map((s) => {
      const c = byId.get(s.queueItemId)
      return { ...s, title: c?.title ?? '', source: c?.source ?? null }
    }),
  }
}
