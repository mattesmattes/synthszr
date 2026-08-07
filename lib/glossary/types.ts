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
  /** true, wenn der Begriffsinhalt in DIESEM Tick frisch generiert wurde (LLM-
   *  Text, von keinem Menschen gelesen) — unabhängig von `origin`. Ein
   *  {lex:}-Tag auf einen frisch generierten Begriff hat also origin='tag' UND
   *  isNewlyGenerated=true: dieselbe Vertrauensstufe wie ein 'new'-Kandidat.
   *  `origin` beschreibt nur die Herkunft (Direktive/Match/LLM-Scan), nicht ob
   *  der Inhalt schon von einem Menschen gesehen wurde — dieses Feld liefert
   *  genau die Information, die dafür fehlt, an Task 11/12 (Freigabe/
   *  Vorauswahl im Editor). */
  isNewlyGenerated: boolean
  /** 1-2 Sätze-Vorschau für das Freigabe-Panel (Task 12). Optional, weil
   *  `pending_glossary_terms` schemaloses JSON ist: Kandidatenlisten, die vor
   *  Einführung dieses Felds geschrieben wurden, haben kein `summary` — der
   *  Editor muss auch dann sauber (ohne Absturz/„undefined") rendern. */
  summary?: string
  /** true, wenn zu diesem Kandidaten noch KEIN Begriff in `glossary_terms`
   *  existiert: der Inhalt wird erst bei der Freigabe erzeugt (Entkopplung
   *  2026-08-04, Befund B). Ein solcher Kandidat hat zwangsläufig keine
   *  `summary` — das Panel zeigt ihn als „wird bei Freigabe erzeugt" statt mit
   *  Vorschautext. Optional aus demselben Grund wie `summary`: Listen, die
   *  vor dem Umbau geschrieben wurden, führen das Feld nicht, und dort ist
   *  „fehlt" gleichbedeutend mit „Begriff existiert schon". */
  needsGeneration?: boolean
  /** true, wenn der Begriff im Lexikon bereits VERÖFFENTLICHT ist. Dann gibt es
   *  nichts freizugeben: er wird beim Speichern nur noch verlinkt.
   *
   *  Betreiber-Wunsch 2026-08-07: das Freigabe-Panel blendet solche Kandidaten
   *  aus, damit die Liste nur noch das zeigt, worüber wirklich zu entscheiden
   *  ist — bei einem Artikel mit 29 Einträgen waren die meisten längst im
   *  Lexikon. Bestätigt bleiben sie trotzdem, sonst verlöre der Artikel ihre
   *  Verlinkung (applyGlossaryConfirmation injiziert Marks NUR für bestätigte
   *  Slugs).
   *
   *  Abgrenzung zu `needsGeneration`: das Feld dort heißt „es existiert noch gar
   *  kein Begriff". Dazwischen liegt der DRAFT — existiert, ist aber noch nicht
   *  im Lexikon und braucht genau diese Freigabe. Ein Draft hat deshalb weder
   *  needsGeneration noch alreadyPublished und bleibt sichtbar.
   *
   *  Optional aus demselben Grund wie die Felder darüber: `pending_glossary_terms`
   *  ist schemaloses JSON, ältere Listen führen es nicht. „Fehlt" bedeutet
   *  „nicht als veröffentlicht bekannt" — solche Kandidaten werden weiterhin
   *  angezeigt, das Panel verliert also nichts, was es früher zeigte. */
  alreadyPublished?: boolean
}
