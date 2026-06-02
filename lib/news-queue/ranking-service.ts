// lib/news-queue/ranking-service.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { isJunkTitle } from './service'
import { runReranker } from './reranker'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { createRun, recordSuggestions, getRankingContext } from './suggestions'
import type { RankingCandidate, RankedSuggestion } from './ranking-types'

// A daily newsletter is curated from the current day's articles, so we feed the
// LLM reranker the whole recent candidate pool. Embedding prefilters/taste models
// underperformed the LLM judge in testing (see the assisted-ranking spec), so
// Stage 1 is just recency + junk filtering; the LLM does the taste judgement.
const MAX_CANDIDATES = 200
const RECENCY_HOURS = 24
const TARGET = 15
// Stubs (headline-only items with almost no body) can't produce an article and
// shouldn't be suggested. Articles run into the thousands of chars; 500 is a safe floor.
const MIN_CONTENT_LENGTH = 500

export interface RankingResult {
  runId: string
  suggestions: Array<RankedSuggestion & { title: string; source: string | null; date: string | null }>
}

export async function generateRankingSuggestions(): Promise<RankingResult> {
  const supabase = createAdminClient()

  // Last 24h of pending candidates (the queue is organized day-wise).
  const since = new Date(Date.now() - RECENCY_HOURS * 3600 * 1000).toISOString()
  const { data: rows } = await supabase
    .from('news_queue')
    .select('id, title, excerpt, source_display_name, total_score, email_received_at, queued_at, content_length')
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .gte('queued_at', since)
    .order('total_score', { ascending: false })
    .limit(300)

  const cleaned = (rows || [])
    .filter((r) => !isJunkTitle(r.title) && (r.content_length ?? 0) >= MIN_CONTENT_LENGTH)
    .slice(0, MAX_CANDIDATES)
  const byId = new Map<string, RankingCandidate>()
  const dateById = new Map<string, string | null>()
  for (const r of cleaned) {
    byId.set(r.id, {
      queueItemId: r.id,
      title: r.title,
      excerpt: r.excerpt,
      source: r.source_display_name,
      totalScore: Number(r.total_score) || 0,
      winnerSimilarity: 0,
    })
    // Newsletter date the article came from (email received), fallback queued.
    dateById.set(r.id, r.email_received_at ?? r.queued_at ?? null)
  }
  const pool = [...byId.values()]

  // No candidates today → nothing to rank.
  if (pool.length === 0) return { runId: '', suggestions: [] }

  // Reranker context from light queries: real recent picks (positives), skipped
  // (negatives), and recently-covered newsletter topics (dedup avoid-list).
  const { positives, negatives, recentlyCovered } = await getRankingContext()
  const suggestions = await runReranker(pool, positives, negatives, TARGET, recentlyCovered)

  const model = await getModelForUseCase('queue_ranking')
  const runId = await createRun({
    candidateCount: pool.length,
    suggestedCount: suggestions.length,
    stage1Method: 'all',
    model,
  })
  await recordSuggestions(runId, suggestions)

  return {
    runId,
    suggestions: suggestions.map((s) => {
      const c = byId.get(s.queueItemId)
      return { ...s, title: c?.title ?? '', source: c?.source ?? null, date: dateById.get(s.queueItemId) ?? null }
    }),
  }
}
