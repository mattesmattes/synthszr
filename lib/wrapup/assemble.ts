/**
 * Baut das TipTap-Dokument des Wochenrückblicks.
 *
 * Der Bericht kommt als ROHE KNOTEN aus dem Tagesartikel — mit Quellenlinks und
 * Lexikon-Verlinkungen. Neu eingesetzt werden nur Vorlauf, Bezugssatz und der
 * gekürzte Take bzw. das Synthszr Update samt Quellen-Absatz (s. generate.ts,
 * research.ts). Bei einem `major`-Update darf der Bericht schrumpfen — aber
 * nur durch WEGLASSEN ganzer Knoten (`selectParagraphs`), nie durch
 * Umformulieren: die Quellen-URLs hängen an den Marks dieser Knoten.
 *
 * Eigene Datei statt inline in der Route: das Zusammensetzen ist die einzige
 * Stelle mit echter Logik im Wrap-up und lässt sich hier ohne Modellaufruf und
 * ohne Datenbank prüfen.
 */
import type { WrapupTopic } from '@/lib/wrapup/collect'
import type { WrapupParts } from '@/lib/wrapup/generate'
import type { TopicUpdate, UpdateSource } from '@/lib/wrapup/research'

type Node = Record<string, unknown>

export const UPDATE_SOURCES_LABEL = 'Update-Quellen: '

/** Das Modell soll die Vorsilbe nicht liefern — wenn doch, steht sie sonst doppelt. */
const LABEL_RE = /^Synthszr (?:Take|Update):\s*/i

function paragraph(text: string): Node {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

/** YYYY-MM-DD → DD.MM.YYYY; Unbekanntes bleibt, wie es ist. */
function germanDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

/**
 * Auswahl der Bericht-Knoten bei einem `major`-Update.
 *
 * `keep` sind Indizes in `nodes` (dieselbe Nummerierung, die der Prompt dem
 * Modell zeigt). Index 0 bleibt immer — er trägt Lead und meist die Quelle;
 * mindestens zwei Knoten bleiben, sonst wäre vom Bericht nichts übrig.
 * Unbrauchbare Indizes werden ignoriert, ohne Auswahl bleibt alles.
 */
export function selectParagraphs(nodes: Node[], keep: number[] | undefined): Node[] {
  if (!keep || keep.length === 0 || nodes.length === 0) return nodes
  const wanted = new Set<number>([0])
  for (const i of keep) {
    if (Number.isInteger(i) && i >= 0 && i < nodes.length) wanted.add(i)
  }
  const min = Math.min(2, nodes.length)
  for (let i = 0; wanted.size < min && i < nodes.length; i++) wanted.add(i)
  return [...wanted].sort((a, b) => a - b).map((i) => nodes[i])
}

/**
 * „Update-Quellen: Titel (Datum), Titel (Datum)" — die Titel als link-Marks
 * (Attribute wie TipTaps Link-Extension in markdown-to-tiptap.ts). Das Update
 * ist der einzige neu geschriebene Text mit Fakten; ohne diese Zeile wäre er
 * die einzige unbelegte Stelle im Artikel.
 */
export function sourcesParagraph(sources: UpdateSource[]): Node {
  const content: Node[] = [{ type: 'text', text: UPDATE_SOURCES_LABEL }]
  sources.forEach((s, idx) => {
    if (idx > 0) content.push({ type: 'text', text: ', ' })
    content.push({
      type: 'text',
      text: s.title,
      marks: [{ type: 'link', attrs: { href: s.url, target: '_blank', rel: 'noopener noreferrer nofollow' } }],
    })
    content.push({ type: 'text', text: ` (${germanDate(s.date)})` })
  })
  return { type: 'paragraph', content }
}

/**
 * Überschrift des Wochentags: „Wochentag — Original-Headline".
 *
 * Der Original-Knoten wird geklont und nur sein Text ersetzt. So bleiben
 * `level` und `queueItemId` erhalten; `bundleType` fällt bewusst weg — die
 * Bündel-Markierung gehört zum Tagesartikel, im Rückblick ist jeder Abschnitt
 * ein Thema des Tages und die Auszeichnung ohne Aussage.
 */
export function buildHeading(topic: WrapupTopic): Node {
  const attrs = { ...((topic.headingNode?.attrs ?? {}) as Record<string, unknown>) }
  delete attrs.bundleType
  return {
    type: 'heading',
    attrs: { level: 2, ...attrs },
    content: [{ type: 'text', text: `${topic.weekday} — ${topic.headline}` }],
  }
}

/**
 * Fügt Originaltexte und generierte Teile zu einem Dokument zusammen.
 *
 * Reihenfolge je Thema: Überschrift, Bericht (unverändert; bei `major` die
 * gewählten Knoten), optionaler Bezugssatz, dann ENTWEDER das Synthszr Update
 * mit Quellen-Absatz ODER der gekürzte Take. Der Bezug steht NACH dem Bericht
 * und VOR der Wertung: er ordnet das Thema in die Woche ein, gehört also
 * weder in den Bericht noch in die Wertung.
 *
 * Ein Update gibt es nur, wenn die RECHERCHE eine Stufe ungleich `none`
 * gemeldet hat. Füllt das Modell `update` trotzdem, wird der Text als Take
 * gesetzt — ohne Update-Label und ohne Quellen, denn es gibt keine.
 *
 * Fehlt zu einem Thema jeder Text in der Modellantwort, bleibt der Abschnitt
 * ohne — besser als ein leerer „Synthszr Take:"-Absatz, der wie ein Fehler
 * aussieht.
 */
// Engerer Typ als WrapupParts: der Zusammenbau braucht die Excerpt-Bullets
// nicht — die gehen ins excerpt-Feld des Posts, nicht ins Dokument. Der
// schmale Parameter macht das sichtbar und haelt die Tests frei von Feldern,
// die hier nichts bewirken.
export function assembleWrapupDoc(
  topics: WrapupTopic[],
  parts: Pick<WrapupParts, 'intro' | 'sections'>,
  updates: TopicUpdate[] = [],
): Node {
  const key = (weekday: string) => weekday.trim().toLowerCase()
  const byWeekday = new Map((parts.sections ?? []).map((s) => [key(s.weekday), s]))
  const updateByWeekday = new Map(updates.map((u) => [key(u.weekday), u]))

  const content: Node[] = []
  if (parts.intro?.trim()) {
    // Der Vorlauf kann mehrere Absätze umfassen, wenn das Modell umbricht.
    for (const block of parts.intro.trim().split(/\n{2,}/)) {
      if (block.trim()) content.push(paragraph(block.trim()))
    }
  }

  for (const topic of topics) {
    const section = byWeekday.get(key(topic.weekday))
    const update = updateByWeekday.get(key(topic.weekday))
    const level = update?.updateLevel ?? 'none'

    content.push(buildHeading(topic))
    content.push(...(level === 'major' ? selectParagraphs(topic.bodyNodes, section?.keepParagraphs) : topic.bodyNodes))

    if (section?.bridge?.trim()) content.push(paragraph(section.bridge.trim()))

    const updateText = section?.update?.trim() ?? ''
    if (level !== 'none' && update && updateText) {
      content.push(paragraph(`Synthszr Update: ${updateText.replace(LABEL_RE, '')}`))
      if (update.sources.length > 0) content.push(sourcesParagraph(update.sources))
      continue
    }
    const takeText = (section?.take ?? section?.update ?? '').trim()
    if (takeText) {
      // Die Vorsilbe setzt diese Funktion, nicht das Modell — sonst stünde sie
      // doppelt da, sobald das Modell sie doch mitliefert.
      content.push(paragraph(`Synthszr Take: ${takeText.replace(LABEL_RE, '')}`))
    }
  }

  return { type: 'doc', content }
}

/**
 * SEO-Beschreibung aus den Excerpt-Bullets des Modells.
 *
 * Format wie im Tagesartikel: „• " je Zeile, durch Zeilenumbrüche getrennt
 * (s. excerptLines in ghostwriter-pipeline.ts). Ohne dieselbe Form sähe die
 * Beschreibung des Rückblicks in Artikelliste und Suchergebnissen anders aus
 * als bei allen anderen Beiträgen.
 *
 * `null` statt eines leeren Strings bei fehlenden Bullets: die Spalte ist
 * nullable, und ein „•" ohne Text wäre schlimmer als gar keine Beschreibung.
 */
export function formatExcerpt(bullets: string[] | undefined): string | null {
  const lines = (bullets ?? [])
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .map((b) => (b.startsWith('•') ? b : `• ${b}`))
  return lines.length > 0 ? lines.join('\n') : null
}
