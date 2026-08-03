/** Obergrenze verlinkter Begriffe pro Artikel. Mehr macht den Text unlesbar. */
export const GLOSSARY_MAX_PER_ARTICLE = 8

/** Mindestlänge eines Begriffsnamens für den Matcher. Kürzere erzeugen zu
 *  viele False Positives (gleiche Schwelle wie bei Chart-Produkten). */
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
  summary: string
}
