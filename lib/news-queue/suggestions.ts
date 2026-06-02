// lib/news-queue/suggestions.ts
import { createAdminClient } from '@/lib/supabase/admin'
import type { RankedSuggestion, LabelExample, UserAction } from './ranking-types'

/** Create a run row, returning its id. */
export async function createRun(meta: {
  candidateCount: number
  suggestedCount: number
  stage1Method: string
  model: string
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('ranking_runs')
    .insert({
      candidate_count: meta.candidateCount,
      suggested_count: meta.suggestedCount,
      stage1_method: meta.stage1Method,
      model: meta.model,
    })
    .select('id')
    .single()
  if (error) throw new Error(`createRun failed: ${error.message}`)
  return data!.id as string
}

/** Persist the LLM suggestions for a run. */
export async function recordSuggestions(runId: string, suggestions: RankedSuggestion[]): Promise<void> {
  if (suggestions.length === 0) return
  const supabase = createAdminClient()
  const rows = suggestions.map((s) => ({
    run_id: runId,
    queue_item_id: s.queueItemId,
    suggested_rank: s.rank,
    llm_reason: s.reason,
    confidence: s.confidence,
    user_action: 'pending' as UserAction,
  }))
  const { error } = await supabase.from('ranking_suggestions').insert(rows)
  if (error) throw new Error(`recordSuggestions failed: ${error.message}`)
}

/** Record a user action on one suggestion (the learning label). */
export async function recordFeedback(
  runId: string,
  queueItemId: string,
  action: UserAction,
  finalRank: number | null
): Promise<void> {
  const supabase = createAdminClient()
  // upsert handles 'added' items that were never suggested
  const { error } = await supabase.from('ranking_suggestions').upsert(
    {
      run_id: runId,
      queue_item_id: queueItemId,
      user_action: action,
      final_rank: finalRank,
      acted_at: new Date().toISOString(),
    },
    { onConflict: 'run_id,queue_item_id' }
  )
  if (error) throw new Error(`recordFeedback failed: ${error.message}`)
}

/**
 * Recent taste labels for the few-shot block.
 * Positives = items that made it into published posts (strongest signal).
 * Negatives = items explicitly rejected in past ranking runs.
 */
export async function getRecentLabels(limit = 15): Promise<{ positives: LabelExample[]; negatives: LabelExample[] }> {
  const supabase = createAdminClient()

  const { data: pos } = await supabase
    .from('ranking_suggestions')
    .select('queue_item_id, news_queue(title, source_display_name)')
    .eq('user_action', 'accepted')
    .order('acted_at', { ascending: false })
    .limit(limit)

  const { data: neg } = await supabase
    .from('ranking_suggestions')
    .select('queue_item_id, news_queue(title, source_display_name)')
    .eq('user_action', 'rejected')
    .order('acted_at', { ascending: false })
    .limit(limit)

  const toExample = (rows: unknown[]): LabelExample[] =>
    (rows as { news_queue: { title: string; source_display_name: string | null } | null }[])
      .filter((r) => r.news_queue)
      .map((r) => ({ title: r.news_queue!.title, source: r.news_queue!.source_display_name }))

  return { positives: toExample(pos || []), negatives: toExample(neg || []) }
}
