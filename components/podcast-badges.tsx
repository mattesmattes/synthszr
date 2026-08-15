import type { ReactNode } from 'react'
import { PODCAST_APPLE as APPLE, PODCAST_SPOTIFY as SPOTIFY } from '@/lib/podcast/platform-links'
import { ApplePodcastsBadge } from '@/components/podcast/apple-podcasts-badge'

/**
 * Die beiden Dienste werden UNTERSCHIEDLICH gerendert, und das ist Absicht:
 *
 *   Apple   inline als SVG-Komponente. Schrift und Apfel liegen auf
 *           currentColor und kippen mit dem Theme; das lila Podcast-Zeichen
 *           behaelt seinen Verlauf. Ein <img src="…svg"> koennte das nicht —
 *           es ist ein eigenes Dokument und erbt keine Textfarbe.
 *   Spotify als <img>. Einfarbig gruen, traegt auf hellem wie dunklem Grund,
 *           braucht also keine Kopplung — und muss dann auch nicht als
 *           Markup im HTML jeder Artikelseite stehen.
 *
 * Beide Grafiken sind dekorativ (aria-hidden bzw. alt=""), den zugaenglichen
 * Namen traegt das aria-label am Link.
 */
function BadgeLink({ name, url, children }: { name: string; url: string; children: ReactNode }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:opacity-80 transition-opacity shrink-0"
      aria-label={name}
    >
      {children}
    </a>
  )
}

/** height als style statt als Tailwind-Klasse: der Wert kommt aus den
 *  Plattformdaten und ist damit zur Bauzeit nicht bekannt — eine dynamisch
 *  zusammengesetzte Klasse wuerde von Tailwind nicht erzeugt. */
function AppleArt({ height }: { height: number }) {
  return <ApplePodcastsBadge className="w-auto" style={{ height }} />
}

function SpotifyArt({ height }: { height: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SPOTIFY.image}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      className="w-auto"
      style={{ height }}
    />
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
        <BadgeLink name={APPLE.name} url={appleEpisodeUrl || APPLE.url}>
          <AppleArt height={APPLE.height} />
        </BadgeLink>
        {children && (
          <div className="order-last w-full flex justify-center md:order-none md:w-auto md:flex-1 md:min-w-0">
            {children}
          </div>
        )}
        <BadgeLink name={SPOTIFY.name} url={SPOTIFY.url}>
          <SpotifyArt height={SPOTIFY.height} />
        </BadgeLink>
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
  // bg-background statt bg-white: die Kachel gehoert zur Oberflaeche und dreht
  // mit. Frueher noetig war das Weiss, weil die PNG-Wortmarken schwarz waren —
  // die Vektorfassungen tragen auf beiden Gruenden.
  const kachel =
    'flex flex-1 min-w-0 max-w-44 items-center justify-center rounded-xl ' +
    'bg-background px-3 py-2 shadow-sm hover:shadow-md transition-shadow'
  // Dasselbe Groessenverhaeltnis wie in der grossen Leiste, nur kleiner.
  const h = (basis: number) => Math.round(basis * 0.8)

  return (
    <div className="mt-3 flex items-stretch justify-center gap-2 sm:gap-3">
      <a href={appleUrl || APPLE.url} target="_blank" rel="noopener noreferrer"
         className={kachel} aria-label={APPLE.name}>
        <AppleArt height={h(APPLE.height)} />
      </a>
      <a href={SPOTIFY.url} target="_blank" rel="noopener noreferrer"
         className={kachel} aria-label={SPOTIFY.name}>
        <SpotifyArt height={h(SPOTIFY.height)} />
      </a>
    </div>
  )
}
