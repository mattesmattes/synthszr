import Link from 'next/link'

export interface RelatedTermItem {
  slug: string
  canonicalName: string
}

/**
 * Verwandte Begriffe: aus dem Text dieser Seite gematcht plus semantische
 * Nachbarn (siehe linkRelatedTerms in lib/glossary/detail.ts).
 *
 * Zwei Darstellungen:
 *  - `sidebar` (Desktop, linke Spalte): Textlinks untereinander. Pills brechen
 *    in einer schmalen Spalte hässlich um bzw. erzwingen eine Mindestbreite —
 *    lange Namen wie „Retrieval-Augmented Generation" passen dort nur als
 *    umbrechbarer Text.
 *  - `block` (Mobile, unter dem Artikel): Pills wie bei Produkten und News,
 *    weil dort die volle Breite zur Verfügung steht und die drei Blöcke
 *    einheitlich aussehen sollen.
 *
 * Rendert null bei leerer Liste.
 */
export function RelatedTerms({
  terms,
  lang,
  heading,
  variant = 'block',
}: {
  terms: RelatedTermItem[]
  lang: string
  heading: string
  variant?: 'block' | 'sidebar'
}) {
  if (terms.length === 0) return null

  if (variant === 'sidebar') {
    return (
      <section>
        {/* Design-System-Tokens statt gray-*: nur so trägt die Navigation den
            Dark Mode und eine spätere Farbänderung mit. Die Rubrik ist
            font-mono — dasselbe Signal wie bei den Chart-Leisten, es trennt
            Beschriftung von Inhalt ohne eine zweite Farbe zu brauchen. */}
        <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
          {heading}
        </h2>
        <ul className="space-y-1.5">
          {terms.map((term) => (
            <li key={term.slug}>
              <Link
                href={`/${lang}/glossary/${term.slug}`}
                // hyphens/break-words: lange Begriffe dürfen umbrechen statt die
                // Spalte zu sprengen oder abgeschnitten zu werden.
                // decoration-accent: die Akzentfarbe erscheint erst beim Hover
                // und nur als Unterstreichung — der Text selbst bleibt neutral,
                // damit die Spalte im Ruhezustand nicht mit dem Artikel konkurriert.
                className="block text-sm leading-snug text-foreground/70 hyphens-auto break-words transition-colors hover:text-foreground hover:underline hover:decoration-accent hover:underline-offset-4"
              >
                {term.canonicalName}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-500 mb-2">{heading}</h2>
      <ul className="flex flex-wrap gap-2">
        {terms.map((term) => (
          <li key={term.slug}>
            <Link
              href={`/${lang}/glossary/${term.slug}`}
              className="inline-block rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-600 transition-colors hover:border-black hover:text-black"
            >
              {term.canonicalName}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
