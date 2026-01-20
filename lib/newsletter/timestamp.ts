/**
 * @deprecated DEPRECATED - No longer used since 2026-01-20
 *
 * Replaced by bulletproof gmail_message_id deduplication approach:
 * - Always fetch last 48h
 * - Deduplicate by Gmail message ID (unique, immutable)
 * - No complex timestamp tracking needed
 *
 * See: app/api/fetch-newsletters-stream/route.ts
 *
 * This file is kept for reference only and can be deleted.
 */

import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Get the timestamp of the last successfully fetched newsletter.
 *
 * Reads from the `settings` table (last_newsletter_fetch) which stores
 * the timestamp of the most recent email that was successfully processed.
 * This timestamp is updated after each successful fetch and recalculated
 * when items are deleted.
 *
 * @param supabase - Supabase client
 * @param fallbackHours - Hours to go back if no data exists (default: 36)
 * @returns Date to use as "after" filter for Gmail fetch
 */
export async function getLastFetchTimestamp(
  supabase: SupabaseClient,
  fallbackHours: number = 36
): Promise<Date> {
  // Read from settings table - this is the source of truth
  const { data: setting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'last_newsletter_fetch')
    .single()

  if (setting?.value?.timestamp) {
    const timestamp = new Date(setting.value.timestamp)
    console.log(`[Newsletter Timestamp] Using timestamp from settings: ${timestamp.toISOString()}`)
    return timestamp
  }

  // Fallback: no setting exists, use fallback hours
  const fallback = new Date(Date.now() - fallbackHours * 60 * 60 * 1000)
  console.log(`[Newsletter Timestamp] No timestamp in settings, using fallback: ${fallback.toISOString()} (${fallbackHours}h ago)`)
  return fallback
}

/**
 * Update the stored last_newsletter_fetch setting.
 * Called after a successful fetch to set the timestamp to the newest email date.
 *
 * CRITICAL: Only use NEWSLETTER entries, not articles!
 * Articles set email_received_at to extraction time, which would push the timestamp
 * forward and cause older newsletters to be skipped.
 *
 * @param supabase - Supabase client
 */
export async function updateLastFetchTimestamp(supabase: SupabaseClient): Promise<void> {
  // Get the most recent email_received_at from NEWSLETTERS only (not articles!)
  // Articles use extraction time which would incorrectly advance the timestamp
  const { data: latestItem } = await supabase
    .from('daily_repo')
    .select('email_received_at')
    .eq('source_type', 'newsletter')  // CRITICAL: Only newsletters!
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
 * Recalculate the timestamp after items are deleted.
 *
 * Uses the newest email_received_at from remaining NEWSLETTER items only.
 * Falls back to newest newsletter_date + 23:59:59 if no items exist.
 *
 * @param supabase - Supabase client
 */
export async function recalculateFetchTimestamp(supabase: SupabaseClient): Promise<void> {
  // Get the most recent email_received_at from remaining NEWSLETTER items only
  // Articles use extraction time which would incorrectly advance the timestamp
  const { data: latestItem } = await supabase
    .from('daily_repo')
    .select('email_received_at, newsletter_date')
    .eq('source_type', 'newsletter')  // CRITICAL: Only newsletters!
    .not('email_received_at', 'is', null)
    .order('email_received_at', { ascending: false })
    .limit(1)
    .single()

  if (latestItem?.email_received_at) {
    // Check if this is a real timestamp or a midnight backfill
    const ts = new Date(latestItem.email_received_at)
    const isMidnight = ts.getUTCHours() === 0 && ts.getUTCMinutes() === 0 && ts.getUTCSeconds() === 0

    let newTimestamp: string
    if (isMidnight && latestItem.newsletter_date) {
      // Backfilled timestamp - use end of the newsletter_date instead
      // This prevents re-fetching items from that day
      newTimestamp = `${latestItem.newsletter_date}T23:59:59.000Z`
      console.log(`[Newsletter Timestamp] Detected midnight backfill, using end of day: ${newTimestamp}`)
    } else {
      // Real timestamp
      newTimestamp = latestItem.email_received_at
      console.log(`[Newsletter Timestamp] Using real timestamp: ${newTimestamp}`)
    }

    await supabase
      .from('settings')
      .upsert({
        key: 'last_newsletter_fetch',
        value: { timestamp: newTimestamp }
      }, { onConflict: 'key' })
    return
  }

  // No items exist - use fallback
  const fallback = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()
  await supabase
    .from('settings')
    .upsert({
      key: 'last_newsletter_fetch',
      value: { timestamp: fallback }
    }, { onConflict: 'key' })
  console.log(`[Newsletter Timestamp] No items found, using fallback: ${fallback}`)
}
