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
 * Stacked: Apple + Spotify logos centered in a row on top, the audio
 * player (passed as children) directly underneath. The previous
 * horizontal "logo · player · logo" layout broke on mobile because
 * the player pill needed more horizontal room than the viewport
 * could spare. Stacked works at every breakpoint.
 *
 * YouTube and Audible were intentionally removed earlier — distribution
 * to those is now handled separately and the row stays focused on the
 * two main listening platforms plus the in-page playback.
 */
export function PodcastBadges({ children }: { children?: ReactNode }) {
  return (
    <div className="px-4 py-3" style={{ backgroundColor: '#ffffff' }}>
      <div className="flex flex-col items-center gap-3 pt-2">
        {/* Logos row — centered above the player */}
        <div className="flex items-center justify-center gap-4 sm:gap-6">
          <a
            href={APPLE.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:opacity-80 transition-opacity"
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
          <a
            href={SPOTIFY.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:opacity-80 transition-opacity"
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

        {/* Player row — directly below logos */}
        {children && (
          <div className="flex justify-center w-full">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
