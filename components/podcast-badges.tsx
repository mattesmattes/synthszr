import type { ReactNode } from 'react'

const PODCAST_LINKS = [
  {
    name: 'Apple Podcasts',
    image: '/podcast-apple.png',
    url: 'https://podcasts.apple.com/de/podcast/synthszr/id1879733990',
  },
  {
    name: 'Spotify',
    image: '/podcast-spotify.png',
    url: 'https://open.spotify.com/show/0FJkPjKXvobgqI8U881yiF?si=wMJJ-CQxQdyuW18VXQZQOQ',
  },
  {
    name: 'YouTube',
    image: '/podcast-youtube.png',
    url: 'https://www.youtube.com/playlist?list=PLbU5G7ZFFIS7ULvNAYfEGlMojSzs3NyBf',
  },
  {
    name: 'Audible',
    image: '/podcast-audible.png',
    url: 'https://www.amazon.com/-/de/dp/B0GQ4XGD9L/',
  },
]

export function PodcastBadges({ children }: { children?: ReactNode }) {
  return (
    <div className="px-4 py-3" style={{ backgroundColor: '#ffffff' }}>
      <p className="text-center text-sm italic text-[#1a1a1a] font-serif mx-auto py-1">
        Start your day with something new, weird, and interesting.
      </p>
      <div className="flex items-center justify-center gap-2 sm:gap-3 pt-2">
        {PODCAST_LINKS.map((link) => (
          <a
            key={link.name}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:opacity-80 transition-opacity flex-shrink min-w-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={link.image}
              alt={link.name}
              className="h-auto w-full max-h-9"
              style={{ aspectRatio: '4 / 1' }}
            />
          </a>
        ))}
      </div>
      {children}
    </div>
  )
}
