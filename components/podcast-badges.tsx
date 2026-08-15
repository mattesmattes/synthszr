import type { ReactNode } from 'react'
import { PODCAST_APPLE as APPLE, PODCAST_SPOTIFY as SPOTIFY } from '@/lib/podcast/platform-links'

/**
 * Ein Bild pro Dienst, kein Theme-Umschalten: beide offiziellen Assets bringen
 * ihren Kontrast selbst mit (s. lib/podcast/platform-links.ts). Eine frueher
 * hier stehende Zweitfassung fuer den Dunkelmodus ist damit hinfaellig — sie
 * war ohnehin nur ein Notbehelf um zu kleine, auf Weiss einkomponierte PNGs.
 *
 * `height` kommt aus den Plattformdaten, weil die beiden Assets verschieden
 * gebaut sind: Apple liefert einen Knopf mit Innenabstand, Spotify ein
 * freistehendes Logo. Gleiche Pixelhoehe haette ungleich grosse Schrift ergeben.
 *
 * Das Bild ist dekorativ (alt=""), den zugaenglichen Namen traegt das
 * aria-label am Link.
 */
function BadgeLink({ name, image, height, url }: { name: string; image: string; height: number; url: string }) {
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
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        className="w-auto"
        style={{ height }}
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
export function PodcastBadges({ children, appleEpisodeUrl }: { children?: ReactNode; appleEpisodeUrl?: string | null }) {
  return (
    // bg-background statt eines Inline-Styles mit #ffffff. Der Inline-Style war
    // fuer .dark prinzipiell unerreichbar (Inline schlaegt jeden Selektor), der
    // Streifen blieb im Dunkelmodus deshalb ein weisses Band zwischen Cover und
    // Text. Dieselbe Falle wie bei den Glasebenen des Players.
    <div className="px-4 py-3 bg-background">
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2 md:flex-nowrap md:justify-between md:gap-4 lg:gap-6">
        {/* Apple links to the episode (if known); Spotify stays show-level. */}
        <BadgeLink {...APPLE} url={appleEpisodeUrl || APPLE.url} />
        {children && (
          <div className="order-last w-full flex justify-center md:order-none md:w-auto md:flex-1 md:min-w-0">
            {children}
          </div>
        )}
        <BadgeLink {...SPOTIFY} />
      </div>
    </div>
  )
}

/**
 * Compact, standalone Apple + Spotify badges for the podcast tip-promo
 * (no audio player, no children) — rendered below the promo show notes.
 */
export function PodcastPromoBadges({ appleUrl }: { appleUrl?: string | null }) {
  // Apple links to the specific episode (resolved via iTunes Lookup); Spotify
  // stays show-level (no key-free Spotify episode lookup available).
  const items = [{ ...APPLE, url: appleUrl || APPLE.url }, SPOTIFY]
  return (
    <div className="mt-3 flex items-stretch justify-center gap-2 sm:gap-3">
      {items.map((b) => (
        // bg-background statt bg-white: die Kachel gehoert zur Oberflaeche und
        // dreht mit. Frueher noetig war das Weiss, weil die PNG-Wortmarken
        // schwarz waren — die Vektorfassungen bringen ihren Kontrast selbst mit.
        <a key={b.name} href={b.url} target="_blank" rel="noopener noreferrer"
           className="flex flex-1 min-w-0 max-w-44 items-center justify-center rounded-xl bg-background px-3 py-2 shadow-sm hover:shadow-md transition-shadow">
          {/* Dasselbe Groessenverhaeltnis wie in der grossen Leiste (40 zu 26),
              nur kleiner — ein fester max-h fuer beide haette die Apple-Schrift
              gegenueber Spotify schrumpfen lassen. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b.image} alt={b.name} className="w-auto max-w-full object-contain" style={{ height: Math.round(b.height * 0.7) }} />
        </a>
      ))}
    </div>
  )
}
