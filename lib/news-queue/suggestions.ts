// lib/news-queue/suggestions.ts
import { createAdminClient } from '@/lib/supabase/admin'
import type { RankedSuggestion, UserAction } from './ranking-types'
import { recordQueueEvents, type QueueEventName } from '@/lib/news-queue/events'

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

/** Persist the ranking suggestions for a run. */
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

  // Update the existing suggestion's action fields, preserving suggested_rank/
  // llm_reason/confidence written by recordSuggestions.
  const { data: updated, error: updateError } = await supabase
    .from('ranking_suggestions')
    .update({
      user_action: action,
      final_rank: finalRank,
      acted_at: new Date().toISOString(),
    })
    .eq('run_id', runId)
    .eq('queue_item_id', queueItemId)
    .select('id')

  if (updateError) throw new Error(`recordFeedback update failed: ${updateError.message}`)

  if (!updated || updated.length === 0) {
    // No existing row → the item was user-added (never suggested). Insert it.
    const { error: insertError } = await supabase.from('ranking_suggestions').insert({
      run_id: runId,
      queue_item_id: queueItemId,
      user_action: action,
      final_rank: finalRank,
      acted_at: new Date().toISOString(),
    })
    if (insertError) throw new Error(`recordFeedback insert failed: ${insertError.message}`)
  }

  // Das Panel-Urteil zusätzlich als Queue-Event: Die Herkunftsregel
  // (Betreiber-Vorgabe 2026-10-05, Spec „Herkunft und Hand-Begriff") macht ein
  // Item erst durch ein Operator-Event zum bestätigten Hand-Item — ein im Panel
  // behaltenes Techmeme-Item darf danach nicht mehr wie unberührtes Techmeme
  // verfallen. ranking_suggestions allein sieht die Herkunftsableitung nicht.
  // Best-effort: recordQueueEvents loggt Fehler, wirft nie.
  const event = panelEventFor(action)
  if (event) {
    await recordQueueEvents(supabase, [
      { queue_item_id: queueItemId, event, actor: 'operator', run_id: runId },
    ])
  }
}

/**
 * accepted und added sind ein Ja des Betreibers (added: er hat das Item selbst
 * dazugeholt — „Zugaben des Betreibers sind die wichtigsten Beispiele"),
 * rejected ein Nein. reordered/pending sagen nichts über das Item aus.
 */
function panelEventFor(action: UserAction): QueueEventName | null {
  if (action === 'accepted' || action === 'added') return 'panel_accept'
  if (action === 'rejected') return 'panel_reject'
  return null
}
