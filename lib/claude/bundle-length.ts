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
    const sentences = splitSentences(section)
    return sentences.length <= maxSentences ? section : sentences.slice(0, maxSentences).join(' ')
  }

  const summary = parts.prefix.replace(TAKE_MARKER_RE, '').trim()
  const sentences = splitSentences(summary)
  if (sentences.length <= maxSentences) return section

  const marker = parts.prefix.match(TAKE_MARKER_RE)![0]
  const capped = sentences.slice(0, maxSentences).join(' ')
  return `${capped}\n\n${marker}${parts.take}`
}

/** Entfernt je den letzten Satz aus Zusammenfassung UND Take. */
export function shortenByOneSentence(section: string): string {
  const parts = splitAtTake(section)
  if (!parts) {
    const sentences = splitSentences(section)
    return sentences.length <= 1 ? section : sentences.slice(0, -1).join(' ')
  }

  const marker = parts.prefix.match(TAKE_MARKER_RE)![0]
  const summarySentences = splitSentences(parts.prefix.replace(TAKE_MARKER_RE, '').trim())
  const takeSentences = splitSentences(parts.take)

  const summary = (summarySentences.length > 1 ? summarySentences.slice(0, -1) : summarySentences).join(' ')
  const take = (takeSentences.length > 1 ? takeSentences.slice(0, -1) : takeSentences).join(' ')

  return `${summary}\n\n${marker} ${take}`
}
