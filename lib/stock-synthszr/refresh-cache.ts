import { createAdminClient } from '@/lib/supabase/admin'
import { STOCK_SYNTHSZR_CACHE_MS, MS_PER_DAY } from '@/lib/config/constants'
import { fetchStockSynthszr } from './fetch-synthesis'

/** How many companies to refresh per cron run (budget: ~30s each) */
const MAX_REFRESH_PER_RUN = 5

/** Refresh entries expiring within this window (in days) */
const REFRESH_WINDOW_DAYS = 3

interface RefreshResult {
  refreshed: number
  errors: number
  skipped: number
  details: string[]
}

/**
 * Refresh expiring or already-expired stock_synthszr_cache entries.
 *
 * Prioritizes:
 * 1. Already expired entries (rating currently invisible to users)
 * 2. Entries expiring within REFRESH_WINDOW_DAYS
 *
 * Runs max MAX_REFRESH_PER_RUN generations per invocation to stay
 * within cron timeout and OpenAI rate limits.
 */
export async function refreshExpiringStockRatings(): Promise<RefreshResult> {
  const supabase = createAdminClient()
  const now = new Date()
  const windowEnd = new Date(now.getTime() + REFRESH_WINDOW_DAYS * MS_PER_DAY)

  // Find entries that are expired OR expiring soon, ordered by expiry (oldest first)
  const { data: expiring, error: queryError } = await supabase
    .from('stock_synthszr_cache')
    .select('company, currency, expires_at')
    .lt('expires_at', windowEnd.toISOString())
    .order('expires_at', { ascending: true })
    .limit(MAX_REFRESH_PER_RUN)

  if (queryError) {
    console.error('[StockRefresh] Query error:', queryError.message)
    return { refreshed: 0, errors: 1, skipped: 0, details: [`Query error: ${queryError.message}`] }
  }

  if (!expiring || expiring.length === 0) {
    return { refreshed: 0, errors: 0, skipped: 0, details: ['No entries need refresh'] }
  }

  const alreadyExpired = expiring.filter(e => new Date(e.expires_at) < now).length
  console.log(`[StockRefresh] Found ${expiring.length} entries to refresh (${alreadyExpired} already expired, ${expiring.length - alreadyExpired} expiring soon)`)

  let refreshed = 0
  let errors = 0
  const details: string[] = []

  for (const entry of expiring) {
    const isExpired = new Date(entry.expires_at) < now
    const label = `${entry.company} (${entry.currency})${isExpired ? ' [expired]' : ' [expiring]'}`

    try {
      console.log(`[StockRefresh] Regenerating ${label}...`)

      const result = await fetchStockSynthszr({
        company: entry.company,
        currency: entry.currency,
        recencyDays: 90,
      })

      const refreshedAt = new Date()
      const newExpiresAt = new Date(refreshedAt.getTime() + STOCK_SYNTHSZR_CACHE_MS)

      const { error: upsertError } = await supabase
        .from('stock_synthszr_cache')
        .upsert(
          {
            company: entry.company.toLowerCase(),
            currency: entry.currency,
            data: result,
            model: result.model,
            created_at: refreshedAt.toISOString(),
            expires_at: newExpiresAt.toISOString(),
          },
          {
            onConflict: 'company,currency',
            ignoreDuplicates: false,
          }
        )

      if (upsertError) {
        console.error(`[StockRefresh] Upsert error for ${label}:`, upsertError.message)
        errors++
        details.push(`${label}: upsert error`)
      } else {
        refreshed++
        details.push(`${label}: refreshed`)
        console.log(`[StockRefresh] Refreshed ${label}`)
      }
    } catch (error) {
      errors++
      const msg = error instanceof Error ? error.message : 'Unknown error'
      details.push(`${label}: ${msg}`)
      console.error(`[StockRefresh] Failed ${label}:`, msg)
    }
  }

  return { refreshed, errors, skipped: 0, details }
}
