import { createAdminClient } from '@/lib/supabase/admin'
import type { TipPromo, TipPromoConfig } from './types'

const DEFAULT_CONFIG: TipPromoConfig = { mode: 'rotate', constantId: null }

/**
 * The latest published episode's short show notes for the podcast promo.
 * Shared by getActiveTipPromo (render) and the admin route (live preview).
 * Returns null when no published episode has stored show notes yet.
 */
export async function getLatestPodcastForPromo(): Promise<{ episodeTitle: string; episodeSubtitle: string | null; appleUrl: string | null } | null> {
  const supabase = createAdminClient()
  const { data: ep } = await supabase
    .from('post_podcasts')
    .select('episode_title, episode_subtitle, apple_episode_url')
    .not('podigee_episode_url', 'is', null)
    .not('episode_title', 'is', null)
    .order('podigee_published_at', { ascending: false }) // newest episode
    .limit(1)
    .maybeSingle()
  if (!ep?.episode_title) return null
  return {
    episodeTitle: ep.episode_title,
    episodeSubtitle: ep.episode_subtitle ?? null,
    appleUrl: ep.apple_episode_url ?? null,
  }
}

async function enrichPodcast(promo: TipPromo): Promise<TipPromo | null> {
  if (promo.type !== 'podcast') return promo
  const podcast = await getLatestPodcastForPromo()
  if (!podcast) return null // no episode → don't show the promo
  return { ...promo, podcast }
}

/**
 * Returns the tip-promo to display right now based on global config.
 * Same selection logic as ad-promos (constant pin or deterministic daily rotate).
 *
 * context 'web' (default) schließt newsletter_only-Promos aus: ist der gepinnte
 * Promo newsletter_only, fällt die Auswahl auf die Rotation der übrigen zulässigen
 * Promos zurück — gibt es keine, wird gar kein Promo gezeigt. context 'newsletter'
 * berücksichtigt alle aktiven Promos.
 */
export async function getActiveTipPromo(opts: { context?: 'web' | 'newsletter' } = {}): Promise<TipPromo | null> {
  const context = opts.context ?? 'web'
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

  const eligible = context === 'web'
    ? (promos as TipPromo[]).filter((p) => !p.newsletter_only)
    : (promos as TipPromo[])
  if (eligible.length === 0) return null

  if (config.mode === 'constant' && config.constantId) {
    const pinned = eligible.find((p) => p.id === config.constantId)
    if (pinned) return enrichPodcast(pinned)
    // gepinnter Promo im Web nicht zulässig → auf Rotation der übrigen zurückfallen
  }

  const now = new Date()
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 0)
  const dayOfYear = Math.floor((now.getTime() - startOfYear) / 86400000)
  const idx = dayOfYear % eligible.length
  return enrichPodcast(eligible[idx])
}
