/**
 * Baut das TipTap-Dokument des Wochenrückblicks.
 *
 * Der Bericht kommt als ROHE KNOTEN aus dem Tagesartikel — mit Quellenlinks und
 * Lexikon-Verlinkungen. Neu eingesetzt werden nur Vorlauf, Bezugssatz und der
 * gekürzte Take (s. generate.ts).
 *
 * Eigene Datei statt inline in der Route: das Zusammensetzen ist die einzige
 * Stelle mit echter Logik im Wrap-up und lässt sich hier ohne Modellaufruf und
 * ohne Datenbank prüfen.
 */
import type { WrapupTopic } from '@/lib/wrapup/collect'
import type { WrapupParts } from '@/lib/wrapup/generate'

type Node = Record<string, unknown>

function paragraph(text: string): Node {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
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
 * Reihenfolge je Thema: Überschrift, Bericht (unverändert), optionaler
 * Bezugssatz, gekürzter Take. Der Bezug steht NACH dem Bericht und VOR dem
 * Take: er ordnet das Thema in die Woche ein, gehört also weder in den Bericht
 * (der bleibt unangetastet) noch in die Wertung.
 *
 * Fehlt zu einem Thema ein Take in der Modellantwort, bleibt der Abschnitt ohne
 * — besser als ein leerer „Synthszr Take:"-Absatz, der wie ein Fehler aussieht.
 */
export function assembleWrapupDoc(topics: WrapupTopic[], parts: WrapupParts): Node {
  const byWeekday = new Map(
    (parts.sections ?? []).map((s) => [s.weekday.trim().toLowerCase(), s]),
  )

  const content: Node[] = []
  if (parts.intro?.trim()) {
    // Der Vorlauf kann mehrere Absätze umfassen, wenn das Modell umbricht.
    for (const block of parts.intro.trim().split(/\n{2,}/)) {
      if (block.trim()) content.push(paragraph(block.trim()))
    }
  }

  for (const topic of topics) {
    content.push(buildHeading(topic))
    content.push(...topic.bodyNodes)

    const section = byWeekday.get(topic.weekday.trim().toLowerCase())
    if (section?.bridge?.trim()) content.push(paragraph(section.bridge.trim()))
    if (section?.take?.trim()) {
      // Die Vorsilbe setzt diese Funktion, nicht das Modell — sonst stünde sie
      // doppelt da, sobald das Modell sie doch mitliefert.
      const take = section.take.trim().replace(/^Synthszr Take:\s*/i, '')
      content.push(paragraph(`Synthszr Take: ${take}`))
    }
  }

  return { type: 'doc', content }
}
