/**
 * Reine Entscheidungslogik fuer scripts/dedupe-glossary-terms.ts.
 *
 * Ausgelagert statt im Skript selbst zu leben: das Skript ruft main() beim
 * Import unbedingt auf (echter DB-Verbindungsversuch, process.exit bei
 * Fehlern) und ist deshalb nicht sinnvoll importierbar/testbar. Diese Datei
 * hat keine Nebeneffekte und keinen eigenen Supabase-Client.
 *
 * KRITERIUM, in dieser Reihenfolge (Betreiber-Entscheidung 2026-08-06, nach
 * dem ersten Dry-Run gegen Prod):
 *   1. Mehr eingehende Verlinkungen (Artikel mit glossaryLink-Mark auf den
 *      Slug) gewinnt.
 *   2. Bei Gleichstand: mehr Inhalt (summary + body).
 *   3. Bei erneutem Gleichstand: der aeltere Begriff (created_at).
 *
 * Der urspruengliche Entwurf hatte NUR Kriterium 2 - das waehlte in zwei der
 * vier in Prod gefundenen Paare ausgerechnet den Slug, auf den KEIN Artikel
 * verlinkte ("evals" mit 3972 Zeichen gewann gegen "eval" mit 3699 Zeichen,
 * obwohl 30 Artikel auf "eval" verlinkten und nur 8 auf "evals"). Ein paar
 * hundert Zeichen Inhaltsunterschied sind kein Grund, dutzende bestehende
 * Marks umzubiegen - der hidden-Status ist jederzeit ruecknehmbar, das
 * Umschreiben von Artikeltexten nicht in derselben Weise folgenlos.
 */
import { isValidTipTapDoc, extractPlainText } from '@/lib/glossary/generate'

export interface DedupeRow {
  id: string
  slug: string
  canonical_name: string
  aliases: string[]
  summary: string
  body: unknown
  created_at: string
}

export type DedupeCriterion = 'Verlinkungen' | 'Inhaltslaenge' | 'Alter'

export interface DedupeDecision {
  winner: DedupeRow
  losers: DedupeRow[]
  /** Welches Kriterium den Gewinner gegenueber dem naechstplatzierten Kandidaten
   *  entschieden hat - fuer die Nachvollziehbarkeit in der Skript-Ausgabe. Bei
   *  mehr als zwei Kandidaten bezieht sich das auf den Vergleich Platz 1
   *  gegen Platz 2 (der knappste, also aussagekraeftigste Vergleich). */
  decidingCriterion: DedupeCriterion
  /** Eine Zeile je Kandidat, in Rangfolge (Gewinner zuerst). */
  reasoning: string[]
}

/** Inhaltslaenge: summary + extrahierter Klartext des body. extractPlainText
 *  statt roher JSON-Laenge, sonst zaehlt Struktur-Overhead (Knoten-
 *  Verschachtelung) statt tatsaechlichem Inhalt mit. */
export function contentLength(summary: string, body: unknown): number {
  if (isValidTipTapDoc(body)) return summary.length + extractPlainText(body).length
  return summary.length + JSON.stringify(body ?? '').length
}

/** Merged Aliasse zweier Begriffe: Aliasse des Gewinners + Aliasse des
 *  Verlierers + der canonical_name des Verlierers selbst (er ist unter diesem
 *  Namen bekannt und gesucht worden). Case-insensitive dedupliziert, der
 *  eigene canonical_name des Gewinners fliegt raus (ueber canonical_name
 *  selbst schon abgedeckt). */
export function mergeAliases(
  winner: { canonical_name: string; aliases: string[] },
  loser: { canonical_name: string; aliases: string[] },
): string[] {
  const canonLower = winner.canonical_name.trim().toLowerCase()
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...winner.aliases, ...loser.aliases, loser.canonical_name]) {
    const alias = raw.trim()
    if (!alias) continue
    const key = alias.toLowerCase()
    if (key === canonLower || seen.has(key)) continue
    seen.add(key)
    out.push(alias)
  }
  return out
}

interface Scored {
  row: DedupeRow
  linkCount: number
  contentLen: number
}

/** Welches Kriterium zwischen den beiden bestplatzierten Kandidaten entschieden
 *  hat - dieselbe Vergleichskette wie die Sortierung unten, nur benannt. */
function decidingCriterion(a: Scored, b: Scored): DedupeCriterion {
  if (a.linkCount !== b.linkCount) return 'Verlinkungen'
  if (a.contentLen !== b.contentLen) return 'Inhaltslaenge'
  return 'Alter'
}

/**
 * Entscheidet, welcher von mehreren normalisiert gleichen Begriffen bleibt.
 * `linkCounts` fehlende Einträge gelten als 0 (kein Artikel verlinkt darauf).
 */
export function decidePair(rows: DedupeRow[], linkCounts: Map<string, number>): DedupeDecision {
  const scored: Scored[] = rows.map((row) => ({
    row,
    linkCount: linkCounts.get(row.slug) ?? 0,
    contentLen: contentLength(row.summary, row.body),
  }))
  scored.sort((a, b) =>
    b.linkCount - a.linkCount ||
    b.contentLen - a.contentLen ||
    (a.row.created_at < b.row.created_at ? -1 : 1),
  )
  const winner = scored[0].row
  const losers = scored.slice(1).map((s) => s.row)
  const criterion = scored.length > 1 ? decidingCriterion(scored[0], scored[1]) : 'Verlinkungen'
  const reasoning = scored.map((s, i) =>
    `${i === 0 ? 'GEWINNER' : 'versteckt '} ${s.row.slug} ("${s.row.canonical_name}"): ` +
    `${s.linkCount} Verlinkung(en), ${s.contentLen} Zeichen Inhalt, erstellt ${s.row.created_at}`,
  )
  return { winner, losers, decidingCriterion: criterion, reasoning }
}
