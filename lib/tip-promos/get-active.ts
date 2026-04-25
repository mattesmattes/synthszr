import { createAdminClient } from '@/lib/supabase/admin'
import type { TipPromo, TipPromoConfig } from './types'

const DEFAULT_CONFIG: TipPromoConfig = { mode: 'rotate', constantId: null }

/**
 * Returns the tip-promo to display right now based on global config.
 * Same selection logic as ad-promos (constant pin or deterministic daily rotate).
 */
export async function getActiveTipPromo(): Promise<TipPromo | null> {
  const supabase = createAdminClient()

  const [{ data: configRow }, { data: promos }] = await Promise.all([
    supabase.from('settings').select('value').eq('key', 'tip_promo_config').maybeSingle(),
    supabase
      .from('tip_promos')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  const config: TipPromoConfig = (configRow?.value as TipPromoConfig) ?? DEFAULT_CONFIG

  if (config.mode === 'off') return null

  if (!promos || promos.length === 0) return null

  if (config.mode === 'constant' && config.constantId) {
    const pinned = promos.find(p => p.id === config.constantId)
    if (pinned) return pinned as TipPromo
  }

  const now = new Date()
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 0)
  const dayOfYear = Math.floor((now.getTime() - startOfYear) / 86400000)
  const idx = dayOfYear % promos.length
  return promos[idx] as TipPromo
}
