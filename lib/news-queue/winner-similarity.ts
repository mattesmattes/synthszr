// lib/news-queue/winner-similarity.ts
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Returns a map queueItemId -> max cosine similarity to recent published winners.
 * Items without a winner match (or without an embedding) are absent from the map.
 */
export async function getWinnerSimilarity(
  candidateIds: string[],
  winnerLimit = 60
): Promise<Map<string, number>> {
  if (candidateIds.length === 0) return new Map()
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('get_winner_similarity', {
    candidate_ids: candidateIds,
    winner_limit: winnerLimit,
  })
  if (error) {
    console.error('[Ranking] get_winner_similarity failed:', error)
    return new Map()
  }
  const map = new Map<string, number>()
  for (const row of (data as { queue_item_id: string; similarity: number }[]) || []) {
    map.set(row.queue_item_id, row.similarity)
  }
  return map
}
