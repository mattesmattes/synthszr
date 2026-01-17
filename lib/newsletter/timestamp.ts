/**
 * Newsletter fetch timestamp management
 *
 * The timestamp is always derived from the actual data in daily_repo,
 * ensuring consistency even when items are deleted.
 */

import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Get the timestamp of the last successfully fetched newsletter.
 * This is based on the most recent `email_received_at` in daily_repo,
 * which represents the actual email receipt time (not when added to DB).
 *
 * @param supabase - Supabase client
 * @param fallbackHours - Hours to go back if no data exists (default: 36)
 * @returns Date to use as "after" filter for Gmail fetch
 */
export async function getLastFetchTimestamp(
  supabase: SupabaseClient,
  fallbackHours: number = 36
): Promise<Date> {
  // Get the most recent email_received_at from daily_repo
  // This is the actual email date, not when it was added to the database
  const { data: latestItem } = await supabase
    .from('daily_repo')
    .select('email_received_at')
    .not('email_received_at', 'is', null)
    .order('email_received_at', { ascending: false })
    .limit(1)
    .single()

  if (latestItem?.email_received_at) {
    const timestamp = new Date(latestItem.email_received_at)
    console.log(`[Newsletter Timestamp] Using email_received_at from daily_repo: ${timestamp.toISOString()}`)
    return timestamp
  }

  // Fallback: no data exists, use fallback hours
  const fallback = new Date(Date.now() - fallbackHours * 60 * 60 * 1000)
  console.log(`[Newsletter Timestamp] No data in daily_repo, using fallback: ${fallback.toISOString()} (${fallbackHours}h ago)`)
  return fallback
}

/**
 * Update the stored last_newsletter_fetch setting.
 * This should be called after a successful fetch to record the timestamp.
 *
 * Note: The timestamp is based on email_received_at (actual email date),
 * not collected_at (when added to DB), to ensure correct behavior after re-fetches.
 *
 * @param supabase - Supabase client
 */
export async function updateLastFetchTimestamp(supabase: SupabaseClient): Promise<void> {
  // Get the most recent email_received_at from daily_repo
  const { data: latestItem } = await supabase
    .from('daily_repo')
    .select('email_received_at')
    .not('email_received_at', 'is', null)
    .order('email_received_at', { ascending: false })
    .limit(1)
    .single()

  if (latestItem?.email_received_at) {
    await supabase
      .from('settings')
      .upsert({
        key: 'last_newsletter_fetch',
        value: { timestamp: latestItem.email_received_at }
      }, { onConflict: 'key' })

    console.log(`[Newsletter Timestamp] Updated to: ${latestItem.email_received_at}`)
  }
}

/**
 * Recalculate and update the last_newsletter_fetch timestamp.
 * Call this after deleting items from daily_repo to ensure consistency.
 *
 * @param supabase - Supabase client
 */
export async function recalculateFetchTimestamp(supabase: SupabaseClient): Promise<void> {
  await updateLastFetchTimestamp(supabase)
}
