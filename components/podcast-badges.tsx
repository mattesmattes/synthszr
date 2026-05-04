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

function BadgeLink({ name, image, url }: { name: string; image: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:opacity-80 transition-opacity shrink-0"
      aria-label={name}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt={name}
        width={300}
        height={75}
        loading="lazy"
        decoding="async"
        className="h-auto max-h-9 w-auto"
        style={{ aspectRatio: '4 / 1' }}
      />
    </a>
  )
}

/**
 * Podcast badges + audio player layout — responsive.
 *
 * Mobile (<md): stacked. Apple + Spotify centered in a row, player
 * directly underneath. The player pill needs more horizontal room
 * than a phone viewport gives, so stacking is the only thing that
 * doesn't squeeze either element.
 *
 * Desktop (md+): horizontal. Apple on the left, player in the middle
 * (flex-1 to absorb available space and stay centered), Spotify on
 * the right. Matches the original mockup once there's room.
 *
 * YouTube and Audible were intentionally removed earlier — distribution
 * to those is now handled separately and the row stays focused on the
 * two main listening platforms plus the in-page playback.
 */
export function PodcastBadges({ children }: { children?: ReactNode }) {
  return (
    <div className="px-4 py-3" style={{ backgroundColor: '#ffffff' }}>
      {/* Mobile: stacked logos-then-player */}
      <div className="flex flex-col items-center gap-3 pt-2 md:hidden">
        <div className="flex items-center justify-center gap-4">
          <BadgeLink {...APPLE} />
          <BadgeLink {...SPOTIFY} />
        </div>
        {children && (
          <div className="flex justify-center w-full">{children}</div>
        )}
      </div>

      {/* Desktop: horizontal Apple · Player · Spotify */}
      <div className="hidden md:flex items-center justify-between gap-4 lg:gap-6 pt-2">
        <BadgeLink {...APPLE} />
        <div className="flex flex-1 justify-center min-w-0">
          {children}
        </div>
        <BadgeLink {...SPOTIFY} />
      </div>
    </div>
  )
}
