/**
 * Reduziert das A-Z-Register für die Seitenspalte einer Begriffsseite.
 *
 * WARUM ÜBERHAUPT: bisher stand die vollständige Begriffsliste in jeder
 * Begriffsseite. Bei 17 Begriffen harmlos, bei 500 sind es 500 Links pro Seite —
 * das kostet Egress (die Liste wird je Seite geladen), bläht das HTML auf und
 * verschiebt für Suchmaschinen wie für Sprachmodelle das Verhältnis von Inhalt zu
 * Navigation. Für GEO ist das der teuerste Teil: die zitierfähige Passage
 * verliert an Gewicht, je mehr Boilerplate um sie herum steht.
 *
 * WAS STATTDESSEN: eine Buchstabenleiste mit Anzahl je Buchstabe — sie zeigt den
 * ganzen Bestand, kostet aber nur rund 30 Links — plus die Begriffe des EIGENEN
 * Anfangsbuchstabens als unmittelbare Nachbarschaft. Die vollständige Liste
 * bleibt auf /glossary; damit ist jeder Begriff für Crawler einen Klick entfernt
 * und die Sitemap führt ihn ohnehin.
 *
 * Die Funktion ist pur. Sie entscheidet nur, WAS gezeigt wird — nicht, wie viel
 * geladen wird; das Kürzen der Datenbankabfrage ist eine eigene Sache
 * (getPublishedTermList lädt für dieses Register kein summary).
 */

export interface IndexNavTerm {
  slug: string
  canonicalName: string
}

export interface IndexNavLetter {
  letter: string
  count: number
}

export interface IndexNav {
  /** Alle vorkommenden Anfangsbuchstaben mit Anzahl, sortiert. */
  letters: IndexNavLetter[]
  /** Die Begriffe des aktiven Buchstabens, alphabetisch, inklusive des aktuellen. */
  siblings: IndexNavTerm[]
  /** Gesamtzahl der Begriffe, für den Verweis auf den vollen Index. */
  total: number
  /** Anfangsbuchstabe des aktuellen Begriffs, oder null bei leerer Liste. */
  activeLetter: string | null
}

/**
 * Gruppenschlüssel eines Begriffs.
 *
 * Ziffern und Sonderzeichen laufen unter „#". Sie einzeln zu führen ergäbe
 * Gruppen mit je einem Eintrag und eine Leiste voller Lücken.
 */
function groupKey(name: string): string {
  const first = name.trim().charAt(0).toUpperCase()
  return /\p{L}/u.test(first) ? first : '#'
}

export function buildIndexNav(
  terms: IndexNavTerm[],
  currentSlug: string,
  lang: string = 'de',
): IndexNav {
  if (terms.length === 0) return { letters: [], siblings: [], total: 0, activeLetter: null }

  const byLetter = new Map<string, IndexNavTerm[]>()
  for (const term of terms) {
    const key = groupKey(term.canonicalName)
    if (!byLetter.has(key)) byLetter.set(key, [])
    byLetter.get(key)!.push(term)
  }

  // localeCompare statt Codepoint-Vergleich: im Deutschen gehört „Ü" zwischen T
  // und V, nicht hinter Z. „#" wird davor gezogen — Ziffern kommen vor Buchstaben.
  const letters = [...byLetter.entries()]
    .map(([letter, group]) => ({ letter, count: group.length }))
    .sort((a, b) => {
      if (a.letter === '#') return -1
      if (b.letter === '#') return 1
      return a.letter.localeCompare(b.letter, lang)
    })

  const current = terms.find((t) => t.slug === currentSlug)
  // Fallback auf die erste Gruppe, wenn der Slug nicht in der Liste steht. Das
  // kann bei einem Sprachwechsel passieren (Slug deutsch, Namen übersetzt); eine
  // leere Nachbarliste wäre dort die schlechtere Antwort als eine unpassende.
  const activeLetter = current ? groupKey(current.canonicalName) : letters[0].letter

  const siblings = (byLetter.get(activeLetter) ?? [])
    .slice()
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName, lang))

  return { letters, siblings, total: terms.length, activeLetter }
}
