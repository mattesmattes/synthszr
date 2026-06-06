import type { ReactNode } from 'react'
import { PODCAST_APPLE as APPLE, PODCAST_SPOTIFY as SPOTIFY } from '@/lib/podcast/platform-links'

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
        loading="lazy"
        decoding="async"
        className="w-auto"
        style={{ height: 30 }}
      />
    </a>
  )
}

/**
 * Podcast badges + audio player layout — responsive, single DOM tree.
 *
 * Critical: `children` (the AudioPlayer) MUST appear exactly once in the
 * tree. An earlier version rendered separate mobile and desktop wrappers
 * with `md:hidden` / `hidden md:flex`, which mounted AudioPlayer twice.
 * The hidden mobile instance had its IntersectionObserver target sitting
 * inside `display:none`, so it always reported "cover not visible" and
 * its Flying-Nav portal stayed pinned to the top of the page — the user
 * saw the player twice (once at the top, once inline).
 *
 * Layout achieved with one flex container + flex-wrap + order:
 *
 * Mobile (<md): wraps. Apple + Spotify on row 1 (centered), Player
 * forced to row 2 via `w-full` (wraps because it can't fit alongside
 * the badges) and `order-last` (sits after Spotify in DOM-order
 * after wrap).
 *
 * Desktop (md+): nowrap. Apple on the left, Player in the middle
 * (flex-1, order reset), Spotify on the right.
 */
export function PodcastBadges({ children, hideBadges = false }: { children?: ReactNode; hideBadges?: boolean }) {
  return (
    <div className="px-4 py-3" style={{ backgroundColor: '#ffffff' }}>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2 md:flex-nowrap md:justify-between md:gap-4 lg:gap-6">
        {!hideBadges && <BadgeLink {...APPLE} />}
        {children && (
          <div className="order-last w-full flex justify-center md:order-none md:w-auto md:flex-1 md:min-w-0">
            {children}
          </div>
        )}
        {!hideBadges && <BadgeLink {...SPOTIFY} />}
      </div>
    </div>
  )
}

/**
 * Compact, standalone Apple + Spotify badges for the podcast tip-promo
 * (no audio player, no children) — rendered below the promo show notes.
 */
export function PodcastPromoBadges() {
  return (
    <div className="mt-3 flex flex-col items-center gap-2.5">
      {[APPLE, SPOTIFY].map((b) => (
        <a key={b.name} href={b.url} target="_blank" rel="noopener noreferrer"
           className="flex w-56 items-center justify-center rounded-2xl bg-white px-5 py-2.5 shadow-sm hover:shadow-md transition-shadow">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b.image} alt={b.name} style={{ height: 30, width: 'auto' }} />
        </a>
      ))}
    </div>
  )
}
