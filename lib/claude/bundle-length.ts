// Deterministischer Längen-Cap fürs Artikel-Bündeln.
//
// Bundle-Artikel fassen mehrere News-Queue-Items in einer Section zusammen;
// ohne Grenze wächst die Zusammenfassung mit der Anzahl gebündelter Items.
// Dieses Modul deckelt sie hart auf eine Satzzahl (Cap) bzw. kürzt sie um
// genau einen Satz (Retry nach zu langer Generierung) — beides rein
// regelbasiert, ohne LLM-Aufruf. Der 18-Satz-Cap gilt NUR für die
// Zusammenfassung (Bericht-Teil); der Synthszr Take zählt nicht mit und
// bleibt bei capSummarySentences unangetastet.
//
// Satz-Splitting und Take-Marker-Erkennung werden aus take-ending.ts
// wiederverwendet statt dupliziert.

import { splitAtTake, splitSentences, TAKE_MARKER_RE } from './take-ending'

// Ein Absatz/Satz, der AUSSCHLIESSLICH aus {Company}-Tags besteht — optional
// gefolgt von einer Quellen-Pfeil-Zeile "→ [Name](URL)". Hier hochgezogen
// (statt in ghostwriter-pipeline.ts dupliziert) und von dort re-exportiert,
// damit shortenBySentences unten dieselbe Definition nutzt wie
// extractBundleTagLine — ein zirkulärer Import (ghostwriter-pipeline.ts
// importiert bereits aus diesem Modul) wäre sonst die Alternative.
export const BUNDLE_TAG_LINE_RE = /^\s*(?:\{[^}\n]+\}\s*)+(?:→\s*\[[^\]\n]*\]\([^)\n]*\)\s*)?$/

// splitSentences kollabiert Whitespace zu einem Space. Eine führende
// Markdown-Heading-Zeile ("## …") würde dabei mit dem ersten Satz verschmelzen
// und das ganze `##`-Heading den Text verschlucken. Wir ziehen die Heading-Zeile
// deshalb VOR dem Satz-Splitting ab und stellen sie danach wieder voran.
function splitHeading(text: string): { heading: string; body: string } {
  const match = text.match(/^\s*(#{1,6}[^\n]*)\n+([\s\S]*)$/)
  if (match) return { heading: match[1].trim(), body: match[2].trim() }
  return { heading: '', body: text.trim() }
}

const withHeading = (heading: string, body: string): string =>
  heading ? `${heading}\n\n${body}` : body

/** Trennt eine Section in Zusammenfassung (vor dem Marker) und Take (danach). */
export function splitSummaryAndTake(section: string): { summary: string; take: string } {
  const parts = splitAtTake(section)
  if (!parts) return { summary: section.trim(), take: '' }
  return {
    summary: parts.prefix.replace(TAKE_MARKER_RE, '').trim(),
    take: parts.take.trim(),
  }
}

/** Kürzt NUR die Zusammenfassung auf ≤ maxSentences Sätze; der Take bleibt vollständig. */
export function capSummarySentences(section: string, maxSentences: number): string {
  const parts = splitAtTake(section)
  if (!parts) {
    const { heading, body } = splitHeading(section)
    const sentences = splitSentences(body)
    if (sentences.length <= maxSentences) return section
    return withHeading(heading, sentences.slice(0, maxSentences).join(' '))
  }

  const { heading, body } = splitHeading(parts.prefix.replace(TAKE_MARKER_RE, ''))
  const sentences = splitSentences(body)
  if (sentences.length <= maxSentences) return section

  const marker = parts.prefix.match(TAKE_MARKER_RE)![0]
  const capped = sentences.slice(0, maxSentences).join(' ')
  return `${withHeading(heading, capped)}\n\n${marker}${parts.take}`
}

/** Entfernt je die letzten `count` Sätze aus Zusammenfassung UND Take (Default 1). */
export function shortenBySentences(section: string, count = 1): string {
  // Bei einer NORMALEN Section hat joinCompanyTagToSummary die {Company}-Tag-/
  // Quellen-Zeile bereits an den letzten Satz der Zusammenfassung angehängt
  // ("…letzter echter Satz. {Anthropic} {OpenAI} → [Quelle](https://…)").
  // splitSentences erkennt den Punkt davor als Satzende und isoliert die
  // Tag-/Quellen-Zeile dadurch als eigenes, LETZTES Element. Ein simples
  // dropLast würde also die Attribution statt eines echten Satzes löschen —
  // Company-Vote-Direktiven + Quelle verschwänden aus jedem normalen Artikel,
  // sobald ein Bündel aktiv ist. Tag-Zeile deshalb beiseite legen, echte
  // Sätze droppen (mindestens einen behalten), Tag-Zeile wieder anhängen.
  const drop = (sentences: string[]): string => {
    const last = sentences[sentences.length - 1]
    if (sentences.length > 1 && last !== undefined && BUNDLE_TAG_LINE_RE.test(last)) {
      const withoutTagLine = sentences.slice(0, -1)
      const keep = Math.max(1, withoutTagLine.length - count)
      return [...withoutTagLine.slice(0, keep), last].join(' ')
    }
    const keep = Math.max(1, sentences.length - count)
    return sentences.slice(0, keep).join(' ')
  }

  const parts = splitAtTake(section)
  if (!parts) {
    const { heading, body } = splitHeading(section)
    return withHeading(heading, drop(splitSentences(body)))
  }

  const marker = parts.prefix.match(TAKE_MARKER_RE)![0]
  const { heading, body } = splitHeading(parts.prefix.replace(TAKE_MARKER_RE, ''))
  const summary = drop(splitSentences(body))
  const take = drop(splitSentences(parts.take))

  return `${withHeading(heading, summary)}\n\n${marker} ${take}`
}
