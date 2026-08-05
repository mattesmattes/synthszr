import Link from 'next/link'
import { buildIndexNav, type IndexNavTerm } from '@/lib/glossary/index-nav'

export type { IndexNavTerm }

/**
 * Register-Navigation in der Seitenspalte einer Begriffsseite.
 *
 * REDUZIERT STATT VOLLSTÄNDIG (2026-08-04). Vorher standen hier ALLE Begriffe,
 * nach Anfangsbuchstaben gruppiert. Bei 17 Begriffen war das harmlos, bei 500
 * wären es 500 Links in jeder einzelnen Begriffsseite: Egress (die Liste wird pro
 * Seite geladen), aufgeblähtes HTML, und für Suchmaschinen wie Sprachmodelle ein
 * schlechteres Verhältnis von Inhalt zu Boilerplate — für GEO der teuerste Teil,
 * weil die zitierfähige Passage an Gewicht verliert.
 *
 * Jetzt zwei Ebenen:
 *   1. Buchstabenleiste mit Anzahl je Buchstabe. Sie zeigt den GANZEN Bestand,
 *      kostet aber nur rund 30 Links, und führt auf die Anker des Index
 *      (id="letter-X", dort schon vorhanden).
 *   2. Die Begriffe des eigenen Anfangsbuchstabens als nähere Nachbarschaft.
 *
 * Die vollständige Liste bleibt auf /glossary. Damit ist jeder Begriff für
 * Crawler einen Klick entfernt, und die Sitemap führt ihn ohnehin.
 */
export function TermIndexNav({
  terms,
  lang,
  currentSlug,
  heading,
  allLabel,
}: {
  terms: IndexNavTerm[]
  lang: string
  currentSlug: string
  heading: string
  /** Beschriftung des Verweises auf den vollen Index, mit {count}-Platzhalter. */
  allLabel: string
}) {
  const nav = buildIndexNav(terms, currentSlug, lang)
  if (nav.total === 0) return null

  return (
    <nav aria-label={heading}>
      <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
        {heading}
      </h2>

      {/* Buchstabenleiste. title trägt die Anzahl, statt sie neben jeden
          Buchstaben zu schreiben — in einer 11rem-Spalte wäre das Zahlensalat. */}
      <ul className="mb-4 flex flex-wrap gap-x-1.5 gap-y-1">
        {nav.letters.map(({ letter, count }) => (
          <li key={letter}>
            {letter === nav.activeLetter ? (
              /* Aktiver Buchstabe als Akzent-Chip: --accent ist ein kräftiges
                 Rot-Orange mit weißem Vordergrund, hier trägt es die Position
                 sofort erkennbar. Kantig (rounded-sm) passend zu --radius. */
              <span
                aria-current="true"
                className="inline-block rounded-sm bg-accent px-1.5 py-px font-mono text-[11px] font-bold text-accent-foreground"
              >
                {letter}
              </span>
            ) : (
              <Link
                href={`/${lang}/glossary#letter-${letter}`}
                title={`${count}`}
                // prefetch={false}: die Buchstabenleiste sind rund 26 Links, die
                // ALLE auf dieselbe Route zeigen — das Fragment (#letter-X) ist
                // für einen RSC-Prefetch bedeutungslos. Im Netzwerk-Trace der
                // Begriffsseite waren dadurch sechs Prefetches auf /de/glossary
                // zu sehen, 57 KB für Prefetches insgesamt, und das während das
                // LCP-Bild um Bandbreite konkurrierte. Der Verweis auf den
                // vollen Index unten in dieser Navigation prefetcht weiterhin,
                // einer genügt.
                prefetch={false}
                className="font-mono text-[11px] text-foreground/70 transition-colors hover:text-accent"
              >
                {letter}
              </Link>
            )}
          </li>
        ))}
      </ul>

      <ul className="space-y-1">
        {nav.siblings.map((term) => (
          <li key={term.slug}>
            {term.slug === currentSlug ? (
              /* DIE EINE STELLE MIT AKZENTFARBE im Listenteil. Der aktive Begriff
                 ist die Funktion dieser Navigation. Ein 2px-Balken statt
                 eingefärbtem Text: er markiert die Position, ohne den Namen aus
                 der Typografie der Liste zu heben. Kantig, passend zu
                 --radius: 0.125rem im Design-System. */
              <span
                aria-current="page"
                className="flex items-start gap-2 text-sm font-medium leading-snug text-foreground"
              >
                <span className="mt-[0.3em] h-3 w-[2px] shrink-0 bg-accent" aria-hidden />
                <span className="hyphens-auto break-words">{term.canonicalName}</span>
              </span>
            ) : (
              <Link
                href={`/${lang}/glossary/${term.slug}`}
                // pl-[10px] richtet die Namen an der Kante des Akzentbalkens aus,
                // damit die Liste beim aktiven Eintrag nicht springt.
                className="block pl-[10px] text-sm leading-snug text-foreground/80 hyphens-auto break-words underline decoration-accent/60 decoration-1 underline-offset-4 transition-colors hover:text-accent hover:decoration-accent hover:decoration-2"
              >
                {term.canonicalName}
              </Link>
            )}
          </li>
        ))}
      </ul>

      <Link
        href={`/${lang}/glossary`}
        className="mt-3 inline-block font-mono text-[10px] font-bold uppercase tracking-wide text-accent transition-colors hover:underline hover:decoration-2 hover:underline-offset-4"
      >
        {allLabel.replace('{count}', String(nav.total))}
      </Link>
    </nav>
  )
}
