/**
 * Zerlegt ein Artikel-TipTap-Dokument in Abschnitte (H2-Grenzen).
 *
 * Auswahlregel (Betreiber-Vorgabe 2026-08-31, geaendert am selben Tag): ALLE
 * Abschnitte werden enriched — Take- und News-Abschnitte gleichermassen.
 * Urspruenglich war die Auswahl auf Take + Top 3 nach news_queue.total_score
 * + Bundle-gelabelte Abschnitte begrenzt (selectSectionsForEnrich); diese
 * Einschraenkung ist entfallen, extractSections() liefert bereits die
 * vollstaendige Kandidatenliste.
 *
 * Reine Funktionen, keine DB-Zugriffe.
 */
import type { TiptapNode, TiptapDoc } from '@/lib/email/tiptap-to-html'
import type { BundleType } from '@/lib/i18n/bundle-labels'

export interface EnrichSection {
  /** Index in doc.content, wo der Abschnitt beginnt (die H2 selbst). */
  startIndex: number
  /** Exklusives Ende (Index der naechsten H2 oder content.length). */
  endIndex: number
  queueItemId: string | null
  bundleType: BundleType | null
  /** true fuer den Synthszr-Take-Abschnitt — hat nie einen queueItemId. */
  isTake: boolean
  /**
   * 0-basierte Ordinalposition unter ALLEN Nicht-Take-Abschnitten OHNE
   * queueItemId, in Dokumentreihenfolge; -1 fuer Take-Abschnitte und
   * Abschnitte MIT queueItemId. Manuell verfasste/nicht an eine News-Queue
   * gebundene Abschnitte haben queueItemId === null — kommt das mehrfach im
   * selben Artikel vor (bestaetigter Praxisfall, zwei Abschnitte ohne
   * queueItemId), reicht "queueItemId === null" allein zur Korrelation
   * NICHT: applySectionResult traf sonst per .find() immer den ERSTEN
   * Treffer und splicte den Abschnitt an die falsche Stelle, wodurch der
   * eigentliche Zielabschnitt unveraendert blieb UND ein anderer doppelt
   * mit fremdem Inhalt ueberschrieben wurde.
   */
  nullIndex: number
  /** Nur fuer Log-/Status-Zwecke, kein Bestandteil der Auswahllogik. */
  headingText: string
}

const TAKE_HEADING_RE = /synthszr take|mattes synthese/i

function headingText(node: TiptapNode): string {
  return (node.content || []).map((c) => c.text || '').join('')
}

/**
 * Zerteilt das Dokument an jeder H2-Ueberschrift. Alles VOR der ersten H2
 * (Titel-Absaetze, Frontmatter-aehnliche Bloecke) gehoert zu keinem Abschnitt
 * und wird nie enriched — nur echte News-/Take-Abschnitte sind Kandidaten.
 */
export function extractSections(doc: TiptapDoc): EnrichSection[] {
  const content = doc.content || []
  const sections: EnrichSection[] = []
  let current: EnrichSection | null = null
  let nextNullIndex = 0

  for (let i = 0; i < content.length; i++) {
    const node = content[i]
    if (node.type === 'heading' && Number(node.attrs?.level) === 2) {
      if (current) { current.endIndex = i; sections.push(current) }
      const text = headingText(node)
      const queueItemId = (node.attrs?.queueItemId as string) || null
      const isTake = TAKE_HEADING_RE.test(text)
      current = {
        startIndex: i,
        endIndex: content.length,
        queueItemId,
        bundleType: (node.attrs?.bundleType as BundleType) || null,
        isTake,
        nullIndex: !isTake && !queueItemId ? nextNullIndex++ : -1,
        headingText: text,
      }
    }
  }
  if (current) sections.push(current)
  return sections
}

/**
 * Setzt die vom Server zurueckgegebenen Knoten eines ueberarbeiteten
 * Abschnitts ins AKTUELLE Dokument ein. Korreliert bewusst NICHT ueber den
 * urspruenglichen Array-Index (startIndex/endIndex aus der Server-Antwort
 * beziehen sich auf den STAND ZUM ZEITPUNKT DER AUSWAHL) — wenn ein frueherer
 * Abschnitt bereits gesplict wurde und dabei seine Knotenzahl aenderte (fast
 * immer: eine Ueberarbeitung hat selten exakt gleich viele Absaetze),
 * verschieben sich alle NACHFOLGENDEN Indizes. Stattdessen wird der
 * betroffene Abschnitt im AKTUELLEN Dokument per queueItemId (bzw. isTake
 * fuer den Take-Abschnitt, bzw. nullIndex bei queueItemId === null — s.
 * Kommentar bei EnrichSection.nullIndex) neu gesucht. Gibt ein NEUES Dokument
 * zurueck (keine Mutation) — React-State-freundlich. `null`, wenn der Zielabschnitt
 * nicht mehr existiert (z.B. vom User zwischenzeitlich geloescht).
 */
export function applySectionResult(
  doc: TiptapDoc,
  result: { queueItemId: string | null; isTake: boolean; nullIndex: number; nodes: TiptapNode[] },
): TiptapDoc | null {
  const current = extractSections(doc)
  const match = result.isTake
    ? current.find((s) => s.isTake)
    : result.queueItemId
      ? current.find((s) => !s.isTake && s.queueItemId === result.queueItemId)
      : current.find((s) => !s.isTake && !s.queueItemId && s.nullIndex === result.nullIndex)
  if (!match) return null

  const content = doc.content || []
  const newContent = [...content.slice(0, match.startIndex), ...result.nodes, ...content.slice(match.endIndex)]
  return { ...doc, content: newContent }
}
