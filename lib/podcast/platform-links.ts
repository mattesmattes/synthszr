// lib/podcast/platform-links.ts
// Single source of truth for the Synthszr podcast platform links + icons.
// Show-level (not per-episode) — used by web badges, email HTML, and the
// podcast tip-promo.
export const PODCAST_APPLE = {
  name: 'Apple Podcasts',
  image: '/podcast-apple.png',
  url: 'https://podcasts.apple.com/de/podcast/synthszr/id1879733990',
} as const

export const PODCAST_SPOTIFY = {
  name: 'Spotify',
  image: '/podcast-spotify.png',
  url: 'https://open.spotify.com/show/0FJkPjKXvobgqI8U881yiF?si=wMJJ-CQxQdyuW18VXQZQOQ',
} as const
