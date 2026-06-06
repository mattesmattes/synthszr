// Resolve per-episode Apple Podcasts deep links via the public, key-free
// iTunes Lookup API. Spotify has no key-free lookup, so Spotify badges keep
// pointing at the show (see lib/podcast/platform-links.ts).

import { createAdminClient } from '@/lib/supabase/admin'

const APPLE_SHOW_ID = '1879733990'

interface ItunesEpisode {
  wrapperType?: string
  trackName?: string
  releaseDate?: string
  trackViewUrl?: string
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Find the Apple Podcasts episode URL for one episode. Matches by title first
 * (normalized), then by release date (same calendar day). Returns null when the
 * episode isn't found — e.g. Apple hasn't indexed it yet, or no title/date given.
 * Fail-soft: never throws.
 */
export async function fetchAppleEpisodeUrl(
  episodeTitle: string | null,
  publishedDate?: string | null
): Promise<string | null> {
  if (!episodeTitle && !publishedDate) return null
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?id=${APPLE_SHOW_ID}&country=de&media=podcast&entity=podcastEpisode&limit=200`
    )
    if (!res.ok) return null
    const data = (await res.json()) as { results?: ItunesEpisode[] }
    const episodes = (data.results || []).filter((r) => r.trackViewUrl)

    if (episodeTitle) {
      const t = norm(episodeTitle)
      const byTitle = episodes.find((e) => e.trackName && norm(e.trackName) === t)
      if (byTitle?.trackViewUrl) return byTitle.trackViewUrl
    }
    if (publishedDate) {
      const day = publishedDate.slice(0, 10)
      const byDate = episodes.find((e) => e.releaseDate?.slice(0, 10) === day)
      if (byDate?.trackViewUrl) return byDate.trackViewUrl
    }
    return null
  } catch {
    return null
  }
}

/**
 * Fill in apple_episode_url for recently published episodes that don't have one
 * yet (Apple indexes new episodes with a delay, so the value is often missing at
 * publish time). Meant to run from the scheduled-tasks cron. Returns the count
 * filled. Fail-soft.
 */
export async function backfillMissingAppleEpisodeUrls(maxDays = 14): Promise<number> {
  try {
    const supabase = createAdminClient()
    const since = new Date(Date.now() - maxDays * 24 * 60 * 60 * 1000).toISOString()
    const { data: rows } = await supabase
      .from('post_podcasts')
      .select('id, episode_title, podigee_published_at')
      .not('podigee_episode_url', 'is', null)
      .is('apple_episode_url', null)
      .gte('podigee_published_at', since)
    if (!rows || rows.length === 0) return 0

    let filled = 0
    for (const r of rows) {
      const url = await fetchAppleEpisodeUrl(r.episode_title ?? null, r.podigee_published_at ?? null)
      if (url) {
        await supabase.from('post_podcasts').update({ apple_episode_url: url }).eq('id', r.id)
        filled++
      }
    }
    return filled
  } catch {
    return 0
  }
}
