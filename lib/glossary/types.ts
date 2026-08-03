/** Obergrenze verlinkter Begriffe pro Artikel. Mehr macht den Text unlesbar. */
export const GLOSSARY_MAX_PER_ARTICLE = 8

/** Schwelle, ab der ein Begriffsname als „lang" gilt. Kurze Namen werden nicht
 *  verworfen, sondern strenger gematcht: sie brauchen eine Wortgrenze auf
 *  beiden Seiten, lange nur davor (siehe boundaryRegex in
 *  lib/glossary/mentions.ts). Ohne diese Unterscheidung würde der 2-Zeichen-
 *  Alias „AI" das Wort „Aida" treffen, oder die Abkürzungen MoE/RAG/LLM wären
 *  gar nicht verlinkbar. Gleicher Wert wie bei Chart-Produkten. */
export const GLOSSARY_MIN_NAME_LENGTH = 4

export type GlossaryStatus = 'draft' | 'published' | 'hidden'
export type GlossaryReviewState = 'ok' | 'flagged' | 'revision_pending'
export type GlossaryCandidateOrigin = 'tag' | 'match' | 'new'

/** Minimalform für den Matcher — bewusst ohne body/embedding, damit die
 *  Begriffsliste schmal geladen werden kann. */
export interface GlossaryMatcherTerm {
  slug: string
  canonicalName: string
  aliases: string[]
}

export interface GlossaryTerm extends GlossaryMatcherTerm {
  id: string
  status: GlossaryStatus
  summary: string
  body: unknown
  illustrationUrl: string | null
  illustrationAlt: string | null
}

export interface GlossaryMention {
  slug: string
  /** Die tatsächlich im Text gefundene Schreibweise. */
  matchedText: string
}

export interface GlossaryCandidate {
  slug: string
  name: string
  origin: GlossaryCandidateOrigin
  /** Die im Artikeltext gefundene Textstelle — nur bei origin='match' gesetzt
   *  (aus GlossaryMention.matchedText). Bei 'tag'/'new' gibt es keine Textstelle:
   *  der Begriff kommt aus einer {lex:}-Direktive bzw. einem LLM-Vorschlag, nicht
   *  aus einem Text-Match. */
  matchedText: string | null
}
