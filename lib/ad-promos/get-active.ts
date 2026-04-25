import { createAdminClient } from '@/lib/supabase/admin'
import type { AdPromo, AdPromoConfig } from './types'

const DEFAULT_CONFIG: AdPromoConfig = { mode: 'rotate', constantId: null }

/**
 * Returns the promo to display right now based on global config:
 * - mode='constant': show the configured constantId (or first active if missing)
 * - mode='rotate':  pick deterministically by current UTC date so all visitors
 *                   see the same promo within a 24h window
 */
export async function getActiveAdPromo(): Promise<AdPromo | null> {
  const supabase = createAdminClient()

  const [{ data: configRow }, { data: promos }] = await Promise.all([
    supabase.from('settings').select('value').eq('key', 'ad_promo_config').maybeSingle(),
    supabase
      .from('ad_promos')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  const config: AdPromoConfig = (configRow?.value as AdPromoConfig) ?? DEFAULT_CONFIG

  if (config.mode === 'off') return null

  if (!promos || promos.length === 0) return null

  if (config.mode === 'constant' && config.constantId) {
    const pinned = promos.find(p => p.id === config.constantId)
    if (pinned) return pinned as AdPromo
    // Fall through to rotation if constantId no longer exists/active
  }

  // Rotate by day-of-year so all visitors see the same promo today
  const now = new Date()
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 0)
  const dayOfYear = Math.floor((now.getTime() - startOfYear) / 86400000)
  const idx = dayOfYear % promos.length
  return promos[idx] as AdPromo
}
