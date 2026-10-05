/**
 * Filter-Pillen der News-Queue (app/admin/news-queue/page.tsx).
 *
 * Eine Pille trifft eine Meldung, wenn ihr Name (ohne Groß-/Kleinschreibung)
 * im Suchtext vorkommt — Titel, Auszug, Quelle und Herkunft, s. herkunftOf in
 * der Seite.
 *
 * REST-MODUS (Betreiber-Vorgabe 2026-10-05): Ist keine Pille aktiv, zeigt
 * „Pending" nur die Meldungen, die KEINE Pille trifft. Wer eine OpenAI-Pille
 * angelegt hat, soll ohne Auswahl keine OpenAI-Meldungen in der Liste sehen —
 * die findet er über die Pille selbst. In Selected/Used/… bleibt ohne Pille
 * alles sichtbar, sonst verschwänden dort etwa ausgewählte OpenAI-Meldungen.
 */
export function filterByTags<T>(
  items: T[],
  opts: {
    /** Name der aktiven Pille, null = keine aktiv. */
    activeLabel: string | null
    /** Namen ALLER angelegten Pillen (für den Rest-Modus). */
    allLabels: string[]
    /** Ohne aktive Pille nur den Rest zeigen. */
    restMode: boolean
    haystackOf: (item: T) => string
  },
): T[] {
  const norm = (s: string) => s.toLowerCase().trim()
  const active = opts.activeLabel === null ? '' : norm(opts.activeLabel)

  if (active) return items.filter((item) => norm(opts.haystackOf(item)).includes(active))
  if (!opts.restMode) return items

  // Leere Namen raus: ''.includes('') ist immer wahr — eine leere Pille würde
  // im Rest-Modus sonst JEDE Meldung ausblenden.
  const needles = opts.allLabels.map(norm).filter((n) => n.length > 0)
  if (needles.length === 0) return items
  return items.filter((item) => {
    const hay = norm(opts.haystackOf(item))
    return !needles.some((n) => hay.includes(n))
  })
}
