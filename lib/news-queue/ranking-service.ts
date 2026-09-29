// lib/news-queue/ranking-service.ts
//
// WARUM total_score statt LLM-Reranker/trainiertem Modell:
// Gate-Vergleich über 36 Reranker-Runs (2026-08-25..2026-09-29, gleiche Pools
// und Relevanzmengen; Recall@15 / NDCG@15): die Produktionsmetrik total_score
// erreicht 0.142 / 0.138 und schlägt damit das beste trainierte Modell
// (LambdaRank) mit 0.118 / 0.089, logistische Regression mit 0.104 / 0.116,
// den bisherigen LLM-Reranker mit 0.095 / 0.089 und Random mit 0.018 / 0.015.
// Quelle: scripts/taste-train-report.json (gate_comparison). Deshalb erzeugt
// diese Funktion Vorschläge rein aus total_score + semantischem Themen-Dedup —
// kein LLM-Call, kein Modell zur Laufzeit.
import { createAdminClient } from '@/lib/supabase/admin'
import { isJunkTitle } from './service'
import { dedupeByTopic, type DedupItem } from './semantic-dedup'
import { createRun, recordSuggestions } from './suggestions'
import type { RankedSuggestion } from './ranking-types'

// A daily newsletter is curated from the current day's articles, so Stage 1
// looks at the whole recent candidate pool: recency + junk filtering only.
const MAX_CANDIDATES = 200
const RECENCY_HOURS = 24
const TARGET = 15
// Stubs (headline-only items with almost no body) can't produce an article and
// shouldn't be suggested. Articles run into the thousands of chars; 500 is a safe floor.
const MIN_CONTENT_LENGTH = 500
// How many of the top (by total_score) Stage-1 candidates go through semantic
// dedup before picking TARGET suggestions from what's left.
const DEDUP_POOL = 40
// Also drop candidates that repeat news already covered in newsletters
// published within this window (see semantic-dedup.getRecentCoverageEmbeddings).
const RECENT_COVERAGE_DAYS = 7

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

  // No candidates today → nothing to rank.
  if (cleaned.length === 0) return { runId: '', suggestions: [] }

  const byId = new Map<string, { title: string; source: string | null }>()
  const dateById = new Map<string, string | null>()
  for (const r of cleaned) {
    byId.set(r.id, { title: r.title, source: r.source_display_name })
    // Newsletter date the article came from (email received), fallback queued.
    dateById.set(r.id, r.email_received_at ?? r.queued_at ?? null)
  }

  // Top candidates by total_score (already the query's sort order) go through
  // semantic dedup so near-duplicate coverage of the same event doesn't crowd
  // out the suggestion list.
  const dedupCandidates: DedupItem[] = cleaned.slice(0, DEDUP_POOL).map((r) => ({
    id: r.id,
    title: r.title,
    content: r.excerpt ?? null,
    total_score: Number(r.total_score) || 0,
  }))
  const { kept } = await dedupeByTopic(dedupCandidates, { recentCoverageDays: RECENT_COVERAGE_DAYS })

  const finalists = kept.slice(0, TARGET)
  const topScore = finalists.length > 0 ? finalists[0].total_score ?? 0 : 0

  const suggestions: RankedSuggestion[] = finalists.map((item, i) => {
    const score = item.total_score ?? 0
    return {
      queueItemId: item.id,
      rank: i + 1,
      reason: `total_score ${score.toFixed(1)}`,
      confidence: topScore > 0 ? score / topScore : 0,
    }
  })

  const runId = await createRun({
    candidateCount: cleaned.length,
    suggestedCount: suggestions.length,
    stage1Method: 'recency+junk+total_score+dedup',
    model: 'total_score',
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
