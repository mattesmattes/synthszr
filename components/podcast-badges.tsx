import type { ReactNode } from 'react'

const APPLE = {
  name: 'Apple Podcasts',
  image: '/podcast-apple.png',
  url: 'https://podcasts.apple.com/de/podcast/synthszr/id1879733990',
}

const SPOTIFY = {
  name: 'Spotify',
  image: '/podcast-spotify.png',
  url: 'https://open.spotify.com/show/0FJkPjKXvobgqI8U881yiF?si=wMJJ-CQxQdyuW18VXQZQOQ',
}

/**
 * Podcast badges + audio player layout.
 *
 * Renders a single horizontal row: Apple Podcasts on the left, the audio
 * player (passed as children) in the middle, Spotify on the right. YouTube
 * and Audible were intentionally removed — distribution to those is now
 * handled separately and the player area should stay focused on the two
 * main listening platforms plus the in-page playback.
 */
export function PodcastBadges({ children }: { children?: ReactNode }) {
  return (
    <div className="px-4 py-3" style={{ backgroundColor: '#ffffff' }}>
      <div className="flex items-center justify-between gap-2 sm:gap-4 pt-2">
        <a
          href={APPLE.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:opacity-80 transition-opacity shrink-0"
          aria-label={APPLE.name}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={APPLE.image}
            alt={APPLE.name}
            width={300}
            height={75}
            loading="lazy"
            decoding="async"
            className="h-auto max-h-9 w-auto"
            style={{ aspectRatio: '4 / 1' }}
          />
        </a>

        {/* Player slot — flex-1 so it absorbs the available middle space.
            justify-center inside keeps the player visually centered even
            on wide layouts. */}
        <div className="flex flex-1 justify-center min-w-0">
          {children}
        </div>

        <a
          href={SPOTIFY.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:opacity-80 transition-opacity shrink-0"
          aria-label={SPOTIFY.name}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={SPOTIFY.image}
            alt={SPOTIFY.name}
            width={300}
            height={75}
            loading="lazy"
            decoding="async"
            className="h-auto max-h-9 w-auto"
            style={{ aspectRatio: '4 / 1' }}
          />
        </a>
      </div>
    </div>
  )
}
