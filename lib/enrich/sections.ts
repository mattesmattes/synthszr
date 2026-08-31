/**
 * Zerlegt ein Artikel-TipTap-Dokument in Abschnitte (H2-Grenzen) und
 * entscheidet, welche davon "Enrich" bekommen sollen.
 *
 * Auswahlregel (Betreiber-Vorgabe 2026-08-31): der Synthszr-Take-Abschnitt
 * IMMER, plus unter den News-Abschnitten (die, die einen queueItemId tragen)
 * die Top 3 nach news_queue.total_score, PLUS alle, die eines der drei
 * Bundle-Labels (topic/recap/deep_dive) tragen — auch wenn sie nicht unter
 * den Top 3 sind. Der Button ist deshalb IMMER aktiv: solange der Artikel
 * mindestens einen News-Abschnitt hat, gibt es etwas zu enrichen.
 *
 * Reine Funktionen, keine DB-Zugriffe — die Score-Werte werden von aussen
 * hereingereicht (app/api/enrich/route.ts holt sie server-seitig), damit
 * dieses Modul ohne Supabase-Client testbar bleibt.
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

  for (let i = 0; i < content.length; i++) {
    const node = content[i]
    if (node.type === 'heading' && Number(node.attrs?.level) === 2) {
      if (current) { current.endIndex = i; sections.push(current) }
      const text = headingText(node)
      current = {
        startIndex: i,
        endIndex: content.length,
        queueItemId: (node.attrs?.queueItemId as string) || null,
        bundleType: (node.attrs?.bundleType as BundleType) || null,
        isTake: TAKE_HEADING_RE.test(text),
        headingText: text,
      }
    }
  }
  if (current) sections.push(current)
  return sections
}

/**
 * Waehlt die zu enrichenden Abschnitte aus: Take immer, sonst Top 3 nach
 * Score UNION alle mit Bundle-Label. `scoresByQueueItemId` fehlende Eintraege
 * gelten als Score 0 (landen nicht in den Top 3, koennen aber trotzdem ueber
 * ein Label qualifizieren).
 */
export function selectSectionsForEnrich(
  sections: EnrichSection[],
  scoresByQueueItemId: Map<string, number>,
): EnrichSection[] {
  const newsSections = sections.filter((s) => !s.isTake && s.queueItemId)
  const byScore = [...newsSections].sort(
    (a, b) => (scoresByQueueItemId.get(b.queueItemId!) ?? 0) - (scoresByQueueItemId.get(a.queueItemId!) ?? 0),
  )
  const top3 = new Set(byScore.slice(0, 3).map((s) => s.startIndex))
  const labeled = new Set(newsSections.filter((s) => s.bundleType).map((s) => s.startIndex))

  return sections.filter((s) => s.isTake || top3.has(s.startIndex) || labeled.has(s.startIndex))
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
 * fuer den Take-Abschnitt) neu gesucht. Gibt ein NEUES Dokument zurueck
 * (keine Mutation) — React-State-freundlich. `null`, wenn der Zielabschnitt
 * nicht mehr existiert (z.B. vom User zwischenzeitlich geloescht).
 */
export function applySectionResult(
  doc: TiptapDoc,
  result: { queueItemId: string | null; isTake: boolean; nodes: TiptapNode[] },
): TiptapDoc | null {
  const current = extractSections(doc)
  const match = result.isTake
    ? current.find((s) => s.isTake)
    : current.find((s) => !s.isTake && s.queueItemId === result.queueItemId)
  if (!match) return null

  const content = doc.content || []
  const newContent = [...content.slice(0, match.startIndex), ...result.nodes, ...content.slice(match.endIndex)]
  return { ...doc, content: newContent }
}
