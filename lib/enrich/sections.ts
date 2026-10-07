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

/** Stabile Identitaet eines Abschnitts ueber mehrere Dokument-Stände hinweg
 *  (queueItemId, sonst nullIndex, Take separat) — von applySectionResult zum
 *  Wiederfinden genutzt und vom Enrich-Fortsetzungsprotokoll
 *  (app/api/enrich/route.ts, excludeKeys) zum Ausschliessen bereits
 *  verarbeiteter Abschnitte. */
export interface SectionKey {
  queueItemId: string | null
  isTake: boolean
  nullIndex: number
}

/** Prueft, ob ein Abschnitt zu einem SectionKey gehoert — dieselbe
 *  Korrelation wie applySectionResult: isTake identifiziert den einen
 *  Take-Abschnitt, sonst queueItemId, sonst (queueItemId null) nullIndex. */
export function sectionMatchesKey(section: EnrichSection, key: SectionKey): boolean {
  if (key.isTake) return section.isTake
  if (section.isTake) return false
  return key.queueItemId ? section.queueItemId === key.queueItemId : section.nullIndex === key.nullIndex
}

/**
 * Setzt die vom Server zurueckgegebenen Knoten eines ueberarbeiteten
 * Abschnitts ins AKTUELLE Dokument ein. Korreliert bewusst NICHT ueber den
 * urspruenglichen Array-Index (startIndex/endIndex aus der Server-Antwort
 * beziehen sich auf den STAND ZUM ZEITPUNKT DER AUSWAHL) — wenn ein frueherer
 * Abschnitt bereits gesplict wurde und dabei seine Knotenzahl aenderte (fast
 * immer: eine Ueberarbeitung hat selten exakt gleich viele Absaetze),
 * verschieben sich alle NACHFOLGENDEN Indizes. Stattdessen wird der
 * betroffene Abschnitt im AKTUELLEN Dokument per sectionMatchesKey neu
 * gesucht. Gibt ein NEUES Dokument zurueck (keine Mutation) —
 * React-State-freundlich. `null`, wenn der Zielabschnitt nicht mehr
 * existiert (z.B. vom User zwischenzeitlich geloescht).
 */
export function applySectionResult(
  doc: TiptapDoc,
  result: SectionKey & { nodes: TiptapNode[] },
): TiptapDoc | null {
  const current = extractSections(doc)
  const match = current.find((s) => sectionMatchesKey(s, result))
  if (!match) return null

  const content = doc.content || []
  const newContent = [...content.slice(0, match.startIndex), ...result.nodes, ...content.slice(match.endIndex)]
  return { ...doc, content: newContent }
}

/**
 * Heading-Attribute, die den Markdown-Rundgang des Enrich NICHT ueberleben
 * (convertTiptapToMarkdown schreibt im Heading-Fall keine Attrs mit raus, s.
 * lib/utils/tiptap-to-markdown.ts) und deshalb vom urspruenglichen H2
 * zurueckgeschrieben werden. Betreiber-Vorgabe 2026-10-05 (Spec Heading-
 * Marker): neben queueItemId/bundleType auch die Kurations-Attribute
 * queueItemIds/curationRank/curationTier — alle fuenf sind Strings
 * (lib/tiptap/heading-with-queue-id.ts). Fuer den Enrich-Restore muss ein
 * neues Heading-Attr nur hier ergaenzt werden (EnrichSection bleibt bewusst
 * schmal). Damit es ueberhaupt im Dokument steht und Editor-Save/HTML-Parse
 * ueberlebt, muss es zusaetzlich in lib/tiptap/heading-with-queue-id.ts
 * deklariert und in applyBundleMarkers (lib/utils/markdown-to-tiptap.ts)
 * gesetzt werden.
 */
export const PRESERVED_HEADING_ATTRS = ['queueItemId', 'bundleType', 'queueItemIds', 'curationRank', 'curationTier'] as const

/**
 * Schreibt die PRESERVED_HEADING_ATTRS vom urspruenglichen H2 (`original`,
 * in der Enrich-Route sectionNodes[0] — startIndex ist die H2 selbst) auf die
 * neue erste Heading-Node (`target`). Mutiert `target`. Das Original ist die
 * EINZIGE Quelle dieser fuenf Attrs: sie werden am Ziel zuerst entfernt, dann
 * vom Original gesetzt. WARUM: das Modell koennte einen Marker halluzinieren
 * (`<!-- data-curation-tier:held -->` in der Antwort), den der Konverter in
 * markdownToTiptapServer als Attr setzt — massgeblich ist aber das H2 VOR dem
 * Enrich, auch wenn es das Attr gar nicht traegt. Andere Attrs des Ziels
 * (level) bleiben. Nur nicht-leere Strings werden uebernommen — die fuenf
 * Attrs sind laut Vertrag Strings, ein leerer Wert waere ein Marker ohne
 * Inhalt.
 * BEFUND 2026-10-06: als reine Funktion herausgezogen, damit der Restore ohne
 * Route (Session, Supabase, Modell-SDK, SSE) in tests/lib geprueft wird —
 * ein Tippfehler hier machte den Final Cut nach dem ersten Enrich unsichtbar.
 */
export function restorePreservedHeadingAttrs(original: TiptapNode | undefined, target: TiptapNode): void {
  const attrs: Record<string, string | number> = { ...(target.attrs || {}) }
  for (const key of PRESERVED_HEADING_ATTRS) {
    delete attrs[key]
    const value = original?.attrs?.[key]
    if (typeof value === 'string' && value) attrs[key] = value
  }
  target.attrs = attrs
}
