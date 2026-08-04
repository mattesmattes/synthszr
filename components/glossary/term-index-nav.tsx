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
      <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
        {heading}
      </h2>
      <div className="space-y-3">
        {letters.map((letter) => (
          <div key={letter}>
            {/* Buchstabe als Register-Marke: font-mono und eine feine Linie
                gliedern die Liste, ohne eine zweite Farbe einzuführen. */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] font-bold text-muted-foreground/50">{letter}</span>
              <span className="h-px flex-1 bg-border" aria-hidden />
            </div>
            <ul className="mt-1 space-y-1">
              {grouped.get(letter)!.map((term) => (
                <li key={term.slug}>
                  {term.slug === currentSlug ? (
                    /* DIE EINE STELLE MIT AKZENTFARBE. Der aktive Begriff ist die
                       Funktion dieser Navigation — hier zahlt sich Farbe aus, und
                       nur hier. Ein 2px-Balken statt eingefärbtem Text: er markiert
                       die Position im Register, ohne den Namen aus der Typografie
                       der Liste zu heben. Kantig (kein rounded), passend zu
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
                      // pl-[10px] richtet die Namen an der Kante des Akzentbalkens
                      // aus, damit die Liste beim aktiven Eintrag nicht springt.
                      className="block pl-[10px] text-sm leading-snug text-foreground/60 hyphens-auto break-words transition-colors hover:text-foreground hover:underline hover:decoration-accent hover:underline-offset-4"
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
