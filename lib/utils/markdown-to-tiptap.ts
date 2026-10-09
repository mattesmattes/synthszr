import { marked } from 'marked'
import { generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { normalizeQuotes } from '@/lib/utils/typography'
import { HeadingWithQueueId } from '@/lib/tiptap/heading-with-queue-id'
import type { BundleType } from '@/lib/i18n/bundle-labels'

/** Stufe eines Abschnitts im Kurations-Draft (Spec 2026-10-05: Setzliste / Bank / Zurückgehalten). */
export type CurationTier = 'recommended' | 'bench' | 'held'

/**
 * Marker einer Heading-Zeile. Alle Felder optional: ein Bündel-Heading trägt
 * nur bundleType, ein Einzelabschnitt nur queueItemIds, ein Kurations-Draft
 * zusätzlich Rang und Stufe (Spec 2026-10-05, „Heading-Marker"). Das Ordinal
 * (0-basiert über ALLE ATX-Heading-Zeilen H1–H6 außerhalb von Code-Fences, in
 * Dokumentreihenfolge) ist der Schlüssel der Map, die extractBundleMarkers liefert.
 */
export interface BundleMarker {
  bundleType?: BundleType
  queueItemIds?: string[]
  curationRank?: number
  curationTier?: CurationTier
}

const HEADING_LINE_RE = /^\s*#{1,6}\s/
// BEFUND 2026-10-06: Die bisherige BUNDLE_MARKER_RE war mit `$` ans Zeilenende
// gebunden und kannte nur data-bundle-type. Sobald ein zweiter Kommentar auf
// derselben Heading-Zeile stand (`<!-- data-bundle-type:topic --> <!-- data-queue-item-ids:a,b -->`),
// matchte sie gar nicht mehr — kein Marker, und beide Kommentare blieben als
// Text in der Zeile, bis der DOM-Parser sie stumm verwarf. Deshalb jetzt
// generisch: JEDER `<!-- data-<schluessel>:<wert> -->`-Kommentar einer
// Heading-Zeile wird eingesammelt (Reihenfolge egal, auch mitten in der
// Zeile — Vertrag 2.5 schreibt sie ans Zeilenende, aber ein Proofread-LLM kann
// Text dahinter schieben) und aus dem sichtbaren Text entfernt; unbekannte
// Schlüssel und ungültige Werte werden ignoriert, aber ebenfalls entfernt,
// damit nie ein Kommentar als Überschriftentext durchrutscht. Deshalb sind
// beide Gruppen bewusst weit gefasst: der Schlüssel `[A-Za-z0-9_-]+` fängt
// auch ein vom LLM verfälschtes `data-queue_item_ids` oder `data-Bundle-Type`
// (wird entfernt, aber NICHT gesetzt — Schlüssel sind wie Werte
// case-sensitiv, geraten wird nicht); der Wert `[^<>]*?` (auch Whitespace und
// leer) fängt ein „verschönertes" `a, b` oder einen leeren Wert;
// parseMarkerField normalisiert und prüft.
const DATA_MARKER_RE = /\s*<!--\s*data-([A-Za-z0-9_-]+):([^<>]*?)\s*-->/g
// Öffnender/schließender Code-Fence nach CommonMark: bis 3 Leerzeichen Einzug,
// mindestens drei ``` oder ~~~. Zeilen dazwischen werden in TipTap ein
// codeBlock, nie ein Heading — würden sie mitgezählt, verrutschte das Ordinal
// gegenüber applyBundleMarkers (BEFUND 2026-10-06, s. extractBundleMarkers).
// Der Lookahead schließt ```inline``` am Zeilenanfang aus (Backtick-Fences
// dürfen keinen weiteren Backtick in der Zeile haben): als Fence gelesen,
// würden alle Marker bis zum Dokumentende verschluckt.
const FENCE_RE = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/
// news_queue.id ist uuid. queueItemId landet in get_winner_similarity
// (supabase/migrations/20260601000000_assisted_ranking.sql:58) in einem harten
// `::uuid`-Cast — ein einziger verstümmelter Wert in einem veröffentlichten Post
// lässt den ganzen RPC mit `invalid input syntax for type uuid` scheitern, und
// embedQueueItemIds (ab Task 8) überspringt Headings mit gesetzter queueItemId,
// korrigiert ihn also nie mehr. Deshalb schon beim Einlesen filtern.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Beide Wertemengen sind über `satisfies Record<Union, true>` an ihre Union
// gebunden: kommt ein fünfter BundleType hinzu, bricht hier der Typecheck —
// so kann die Liste nicht mehr still auseinanderlaufen wie beim Vorgänger von
// 2026-08 (kannte nur topic|recap und verlor deep_dive/cover_story). Ein
// unbekannter Wert wird wie ein unbekannter Schlüssel behandelt: entfernt,
// aber nicht gesetzt (der Renderer bundle-label.ts:25 zeigt ihn ohnehin nicht).
const BUNDLE_TYPES: ReadonlySet<string> = new Set(
  Object.keys({ topic: true, recap: true, deep_dive: true, cover_story: true } satisfies Record<BundleType, true>),
)
const CURATION_TIERS: ReadonlySet<string> = new Set(
  Object.keys({ recommended: true, bench: true, held: true } satisfies Record<CurationTier, true>),
)

/**
 * Trägt einen erkannten `data-<key>:<value>`-Kommentar in den Marker ein;
 * unbekannte Keys und ungültige Werte bewusst ignoriert. Steht derselbe
 * Schlüssel mehrfach auf einer Zeile, gewinnt der letzte GÜLTIGE Wert — ein
 * ungültiger überschreibt nichts (Testfall „bei doppeltem Schlüssel …").
 */
function parseMarkerField(key: string, rawValue: string, marker: BundleMarker): void {
  const value = rawValue.trim()
  switch (key) {
    case 'bundle-type':
      if (BUNDLE_TYPES.has(value)) marker.bundleType = value as BundleType
      return
    case 'queue-item-ids': {
      // Kleinschreiben, weil Postgres UUIDs klein ausgibt und die Ground Truth
      // (Task 10/11) IDs per String-Vergleich matcht.
      const ids = value
        .split(',')
        .map((id) => id.trim().toLowerCase())
        .filter((id) => UUID_RE.test(id))
      if (ids.length) marker.queueItemIds = ids
      return
    }
    case 'curation-rank':
      // Nur reine Ziffernfolgen: parseInt hätte `3x` als 3 durchgewinkt.
      if (/^\d+$/.test(value)) marker.curationRank = Number(value)
      return
    case 'curation-tier':
      if (CURATION_TIERS.has(value)) marker.curationTier = value as CurationTier
      return
    default:
      return
  }
}

/**
 * Löst alle `<!-- data-*:… -->`-Kommentare von H1–H6-Heading-Zeilen (geschrieben
 * von ensureBundleMarker in ghostwriter-pipeline.ts, ab Task 9 auch
 * ensureQueueIdMarker), entfernt sie aus dem sichtbaren Text und merkt sich je
 * Heading (Ordinal über alle Headings) die erkannten Felder. Das Ordinal wird
 * in applyBundleMarkers gegen die Heading-Knoten aus marked+generateJSON
 * gelegt — Markdown-Headings werden 1:1 und in Reihenfolge zu Top-Level-
 * `heading`-Knoten im TipTap-JSON.
 *
 * Zeilen in Code-Fences bleiben unangetastet und zählen nicht (BEFUND
 * 2026-10-06: `# shell comment` im Fence verschob sonst das Ordinal, und die
 * IDs eines Abschnitts landeten auf dem nächsten — seit queueItemIds die
 * Ground Truth speist, ein Datenfehler). Bekannte, bewusst offene Lücken
 * (im Ghostwriter-Markdown nicht beobachtet): Setext-Headings (`Text` + `===`/
 * `---` in der Folgezeile) werden zu Heading-Knoten, aber nicht gezählt;
 * eingerückte `#`-Zeilen in Listen oder Einzug ≥ 4 werden gezählt, sind in
 * TipTap aber kein Top-Level-Heading.
 */
export function extractBundleMarkers(markdown: string): { cleaned: string; markers: Map<number, BundleMarker> } {
  const markers = new Map<number, BundleMarker>()
  let headingIndex = 0
  let openFence: string | null = null
  const cleanedLines = markdown.split('\n').map((line) => {
    const fence = line.match(FENCE_RE)?.[1]
    if (openFence) {
      // Schließt nur ein Fence aus demselben Zeichen, mindestens gleich lang,
      // ohne Text dahinter (CommonMark) — ein `~~~` in einem `~~~~`-Fence ist Inhalt.
      if (fence && fence[0] === openFence[0] && fence.length >= openFence.length && line.trim() === fence) {
        openFence = null
      }
      return line
    }
    if (fence) {
      openFence = fence
      return line
    }
    if (!HEADING_LINE_RE.test(line)) return line
    const idx = headingIndex
    headingIndex++
    const marker: BundleMarker = {}
    let found = false
    const cleanedLine = line.replace(DATA_MARKER_RE, (_whole: string, key: string, value: string) => {
      found = true
      parseMarkerField(key, value, marker)
      return ''
    })
    if (!found) return line
    if (Object.keys(marker).length) markers.set(idx, marker)
    return cleanedLine.trimEnd()
  })
  return { cleaned: cleanedLines.join('\n'), markers }
}

/**
 * Schreibt die Marker-Attribute auf den N-ten Top-Level-Heading-Knoten
 * (N = Map-Schlüssel; gezählt werden alle Top-Level-Headings jeder Ebene, nicht
 * nur H2) und mutiert das TipTap-JSON in place. No-op ohne Marker.
 *
 * Alle Attribute sind Strings: `TiptapNode.attrs` ist
 * `Record<string, string | number>` (lib/email/tiptap-to-html.ts:68) und
 * HeadingWithQueueId liest/schreibt sie als data-*-HTML-Attribute.
 * `queueItemId` = erste ID bleibt als eigenes Attribut, weil Barometer-Anker
 * (lib/email/tiptap-to-html.ts), die SQL-Funktion get_winner_similarity
 * (supabase/migrations/20260601000000_assisted_ranking.sql:41-63),
 * extractQueueItemIds (lib/synthesis/pipeline.ts:90, getSourcePubRates) und
 * die Ground-Truth-Extraktion (scripts/lib/taste-ground-truth.ts) genau diesen
 * einzelnen String lesen (BEFUND 2026-10-06, Karte C Fallstrick 6).
 */
export function applyBundleMarkers(json: Record<string, unknown>, markers: Map<number, BundleMarker>): void {
  if (!markers.size) return
  const content = (json as { content?: unknown }).content
  if (!Array.isArray(content)) return
  let headingIndex = 0
  for (const node of content) {
    if (!node || typeof node !== 'object' || (node as { type?: unknown }).type !== 'heading') continue
    const marker = markers.get(headingIndex)
    headingIndex++
    if (!marker) continue
    const attrs: Record<string, string> = {}
    if (marker.bundleType) attrs.bundleType = marker.bundleType
    if (marker.queueItemIds?.length) {
      attrs.queueItemId = marker.queueItemIds[0]
      attrs.queueItemIds = marker.queueItemIds.join(',')
    }
    if (marker.curationRank !== undefined) attrs.curationRank = String(marker.curationRank)
    if (marker.curationTier) attrs.curationTier = marker.curationTier
    const n = node as { attrs?: Record<string, unknown> }
    n.attrs = { ...(n.attrs || {}), ...attrs }
  }
}

/**
 * Converts markdown string to TipTap JSON format
 * Includes Link extension to properly handle markdown links
 * Normalizes quotes to German typographic quotes (source language is German)
 */
export function markdownToTiptap(markdown: string): Record<string, unknown> {
  // Normalize quotes to German typographic quotes before processing
  // Source content is always German
  const normalizedMarkdown = normalizeQuotes(markdown, 'de')

  // Extract data-bundle-type markers from heading lines before marked() runs —
  // marked would keep the HTML comment as literal text, and TipTap's DOM
  // parser silently drops HTML comment nodes, losing the signal either way.
  const { cleaned, markers } = extractBundleMarkers(normalizedMarkdown)

  // Convert markdown to HTML
  const html = marked.parse(cleaned, { async: false }) as string

  // Convert HTML to TipTap JSON with Link extension for proper link handling
  // Use HeadingWithQueueId to preserve queueItemId attributes
  const json = generateJSON(html, [
    StarterKit.configure({
      heading: false,
    }),
    HeadingWithQueueId.configure({
      levels: [1, 2, 3, 4, 5, 6],
    }),
    Link.configure({
      openOnClick: false,
    }),
  ])

  applyBundleMarkers(json, markers)

  return json
}

/**
 * Converts TipTap JSON to HTML string
 */
export function tiptapToHtml(json: Record<string, unknown>): string {
  const { generateHTML } = require('@tiptap/core')
  return generateHTML(json, [
    StarterKit.configure({
      heading: false,
    }),
    HeadingWithQueueId.configure({
      levels: [1, 2, 3, 4, 5, 6],
    }),
    Link.configure({
      openOnClick: false,
    }),
  ])
}
