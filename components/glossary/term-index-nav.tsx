import Link from 'next/link'

export interface IndexNavTerm {
  slug: string
  canonicalName: string
}

/**
 * A-Z-Navigation über alle veröffentlichten Begriffe, für die linke Spalte der
 * Detailseite (Desktop) bzw. unter dem Artikel (Mobile).
 *
 * Zweck ist Orientierung im Lexikon: von einer Begriffsseite aus soll jeder
 * andere Begriff erreichbar sein, ohne über den Index zu gehen. Der aktuelle
 * Begriff steht mit drin, aber als nicht klickbarer Marker — ein Link auf die
 * Seite, auf der man schon ist, wäre eine Sackgasse, und ihn weglassen würde
 * die alphabetische Reihenfolge löchrig machen.
 *
 * Gruppiert nach Anfangsbuchstabe wie der Index (app/[lang]/glossary/page.tsx),
 * damit die Reihenfolge zwischen Index und Detailseite dieselbe ist.
 * `localeCompare` mit der Sprache: bei „Ä" vor „B" entscheidet die Locale.
 */
export function TermIndexNav({
  terms,
  lang,
  currentSlug,
  heading,
}: {
  terms: IndexNavTerm[]
  lang: string
  currentSlug: string
  heading: string
}) {
  if (terms.length === 0) return null

  const grouped = new Map<string, IndexNavTerm[]>()
  for (const term of terms) {
    const letter = term.canonicalName.charAt(0).toUpperCase()
    if (!grouped.has(letter)) grouped.set(letter, [])
    grouped.get(letter)!.push(term)
  }
  const letters = [...grouped.keys()].sort((a, b) => a.localeCompare(b, lang))

  return (
    <nav aria-label={heading}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{heading}</h2>
      <div className="space-y-3">
        {letters.map((letter) => (
          <div key={letter}>
            <div className="font-mono text-[11px] text-gray-300">{letter}</div>
            <ul className="mt-0.5 space-y-1">
              {grouped.get(letter)!.map((term) => (
                <li key={term.slug}>
                  {term.slug === currentSlug ? (
                    <span
                      aria-current="page"
                      className="block text-sm font-medium leading-snug text-black hyphens-auto break-words"
                    >
                      {term.canonicalName}
                    </span>
                  ) : (
                    <Link
                      href={`/${lang}/glossary/${term.slug}`}
                      className="block text-sm leading-snug text-gray-500 hyphens-auto break-words transition-colors hover:text-black hover:underline"
                    >
                      {term.canonicalName}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )
}
