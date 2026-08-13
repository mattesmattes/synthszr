/**
 * Zusammengehörige Techmeme-Quellen in der Queue-Liste sichtbar machen.
 *
 * BETREIBER-BEFUND 2026-08-13: Mit aktivem Techmeme-Filter standen vier
 * Cisco-Meldungen auf den Plätzen 1, 3, 4 und 7, dazwischen zwei
 * Bitcoin-Meldungen auf 2 und 5. Dass je vier bzw. zwei davon EINE gebündelte
 * Story sind — und im Artikel EINEN Abschnitt ergeben —, war der Liste nicht
 * anzusehen.
 *
 * Ursache: Sortiert wird nach Punktzahl, und die unterscheidet sich innerhalb
 * einer Story um den Rang-Abschlag (3 % je Stufe). Das ist gerade genug, dass
 * fremde Meldungen dazwischenrutschen.
 *
 * Diese Datei sortiert die Quellen einer Story zusammen und sagt jeder Zeile,
 * ob sie einen Block anführt und wie groß er ist. Die Darstellung selbst bleibt
 * in der Seite.
 */

export interface StoryBlockEntry<T> {
  item: T
  /** Story-Schlüssel, oder null bei einer gewöhnlichen Meldung. */
  storyKey: string | null
  /** Führt diese Zeile einen Block aus MEHREREN Quellen an? */
  blockStart: boolean
  /** Wie viele Zeilen der Block umfasst (1 = keine Bündelung). */
  blockSize: number
  /** Überschrift der Techmeme-Story, für die Kopfzeile des Blocks. */
  headline: string | null
}

interface Sortierbar {
  id: string
  total_score: number
  metadata?: Record<string, unknown> | null
}

function storyOf(item: Sortierbar): string | null {
  const key = item.metadata?.techmeme_story
  return typeof key === 'string' && key.length > 0 ? key : null
}

/**
 * Die Zeilen einer Liste, nach Story-Blöcken sortiert.
 *
 * Blöcke stehen an der Stelle ihrer STÄRKSTEN Meldung. Sonst läge ein Block mit
 * vielen schwachen Quellen vor einem mit einer sehr starken, und die
 * Reihenfolge der Liste verlöre ihre Aussage.
 */
export function buildStoryBlocks<T extends Sortierbar>(items: T[]): StoryBlockEntry<T>[] {
  const bloecke = new Map<string, T[]>()
  const einzeln: T[] = []

  for (const item of items) {
    const key = storyOf(item)
    if (!key) {
      einzeln.push(item)
      continue
    }
    const vorhanden = bloecke.get(key)
    if (vorhanden) vorhanden.push(item)
    else bloecke.set(key, [item])
  }

  // Jeder Block und jede Einzelmeldung wird zu einem Sortier-Element mit dem
  // höchsten Wert, den er enthält.
  type Element = { score: number; key: string | null; zeilen: T[] }
  const elemente: Element[] = [
    ...[...bloecke.entries()].map(([key, zeilen]) => {
      const sortiert = [...zeilen].sort((a, b) => b.total_score - a.total_score)
      return { score: sortiert[0].total_score, key, zeilen: sortiert }
    }),
    ...einzeln.map((item) => ({ score: item.total_score, key: null, zeilen: [item] })),
  ]
  elemente.sort((a, b) => b.score - a.score)

  const out: StoryBlockEntry<T>[] = []
  for (const el of elemente) {
    const groesse = el.zeilen.length
    const headline = groesse > 1
      ? (el.zeilen.find((z) => typeof z.metadata?.techmeme_headline === 'string')
          ?.metadata?.techmeme_headline as string | undefined) ?? null
      : null

    el.zeilen.forEach((item, i) => {
      out.push({
        item,
        storyKey: el.key,
        // Nur ein Block aus MEHREREN Quellen bekommt eine Kopfzeile — bei einer
        // einzigen wäre „1 Quelle" nur Rauschen.
        blockStart: groesse > 1 && i === 0,
        blockSize: groesse,
        headline,
      })
    })
  }
  return out
}
