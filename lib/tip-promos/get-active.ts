import { createAdminClient } from '@/lib/supabase/admin'
import type { TipPromo, TipPromoConfig } from './types'

const DEFAULT_CONFIG: TipPromoConfig = { mode: 'rotate', constantId: null }

async function enrichPodcast(promo: TipPromo): Promise<TipPromo | null> {
  if (promo.type !== 'podcast') return promo
  const supabase = createAdminClient()
  const { data: ep } = await supabase
    .from('post_podcasts')
    .select('show_notes_short, episode_title')
    .not('podigee_episode_url', 'is', null)
    .not('show_notes_short', 'is', null)
    .order('podigee_published_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!ep?.show_notes_short) return null // no episode → don't show the promo
  return { ...promo, podcast: { showNotesShort: ep.show_notes_short, episodeTitle: ep.episode_title ?? null } }
}

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
    if (pinned) return enrichPodcast(pinned as TipPromo)
  }

  const now = new Date()
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 0)
  const dayOfYear = Math.floor((now.getTime() - startOfYear) / 86400000)
  const idx = dayOfYear % promos.length
  return enrichPodcast(promos[idx] as TipPromo)
}
