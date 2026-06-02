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
  if (updated && updated.length > 0) return

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

function safeParse(s: string): unknown { try { return JSON.parse(s) } catch { return null } }

/** Extract the visible heading texts (covered topics) from a post's TipTap JSON. */
function extractHeadingTexts(content: unknown): string[] {
  const out: string[] = []
  const root = typeof content === 'string' ? safeParse(content) : content
  const nodes = Array.isArray(root) ? root : (root as { content?: unknown[] })?.content
  if (!Array.isArray(nodes)) return out
  for (const n of nodes) {
    const node = n as { type?: string; content?: { type?: string; text?: string }[] }
    if (node?.type === 'heading' && Array.isArray(node.content)) {
      const text = node.content.filter((c) => c?.type === 'text').map((c) => c.text || '').join('').trim()
      if (text) out.push(text)
    }
  }
  return out
}

/**
 * Context for the reranker prompt, all from light queries:
 * - positives: titles of articles Mattes actually picked recently (status='used')
 * - negatives: titles he explicitly skipped
 * - recentlyCovered: headings of recently published newsletters (dedup avoid-list)
 */
export async function getRankingContext(opts?: {
  positivesLimit?: number
  coverageDays?: number
}): Promise<{ positives: LabelExample[]; negatives: LabelExample[]; recentlyCovered: string[] }> {
  const positivesLimit = opts?.positivesLimit ?? 40
  const coverageDays = opts?.coverageDays ?? 7
  const supabase = createAdminClient()

  const { data: used } = await supabase
    .from('news_queue')
    .select('title, source_display_name, queued_at')
    .eq('status', 'used')
    .order('queued_at', { ascending: false })
    .limit(positivesLimit)
  const positives: LabelExample[] = (used || []).map((r) => ({ title: r.title, source: r.source_display_name }))

  const { data: skipped } = await supabase
    .from('news_queue')
    .select('title, source_display_name')
    .eq('status', 'skipped')
    .order('queued_at', { ascending: false })
    .limit(20)
  const negatives: LabelExample[] = (skipped || []).map((r) => ({ title: r.title, source: r.source_display_name }))

  const sinceISO = new Date(Date.now() - coverageDays * 24 * 3600 * 1000).toISOString()
  const { data: posts } = await supabase
    .from('generated_posts')
    .select('content, created_at')
    .eq('status', 'published')
    .gte('created_at', sinceISO)
    .order('created_at', { ascending: false })
    .limit(12)
  const recentlyCovered: string[] = []
  for (const p of posts || []) recentlyCovered.push(...extractHeadingTexts(p.content))

  return { positives, negatives, recentlyCovered }
}
