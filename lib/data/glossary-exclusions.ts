/**
 * Wörter, die NIE ein Lexikon-Begriff werden dürfen.
 *
 * Das Auswahlkriterium steht im Prompt (buildCandidatesPrompt) und ist dort
 * ausführlich begründet. Der Prompt allein reicht aber nicht: „Modelle befolgen
 * das nicht zuverlässig" gilt hier genauso wie beim Filtern bekannter Slugs, und
 * jeder Fehlvorschlag kostet einen Modellaufruf plus einen Eintrag, der später
 * von Hand verborgen werden muss.
 *
 * BETREIBER-VORGABE 2026-08-12: „Anbieter, Rechner, Büroarbeit, Fehlerbehebung
 * sind keine Fachwörter." Alle vier standen zu dem Zeitpunkt als offene
 * Kandidaten in der Warteschlange, obwohl der Prompt Allgemeinwörter bereits
 * ausschließt — deshalb zusätzlich diese harte, deterministische Liste.
 *
 * WAS HIERHER GEHÖRT: allgemeinverständliche deutsche Wörter, die ein Erwachsener
 * ohne Fachwissen versteht. Nicht: Fachbegriffe, die nur selten vorkommen.
 *
 * WAS NICHT HIERHER GEHÖRT: Firmennamen und Markenprodukte — die schließt der
 * Prompt aus, und benannte Technologien (gVisor, Graviton) sollen ausdrücklich
 * aufgenommen werden. Eine Sperre hier träfe beide gleichermaßen.
 *
 * Der Vergleich läuft normalisiert (klein, Umlaute aufgelöst, ohne Bindestriche),
 * damit „Büroarbeit", „bueroarbeit" und „Büro-Arbeit" derselbe Eintrag sind.
 * Zusammensetzungen sind NICHT mitgemeint: „Anbieter" ist gesperrt,
 * „Lock-in (Anbieterbindung)" bleibt ein gültiger Begriff.
 */
export const EXCLUDED_GLOSSARY_TERMS: Set<string> = new Set([
  // Betreiber-Vorgabe 2026-08-12
  'anbieter',
  'rechner',
  'buroarbeit',
  // Umlaut-Transkription eigens gelistet: normalize() löst „ü" zu „u" auf, aber
  // eine generische ue→u-Regel wäre gefährlich (sie träfe auch „Queue").
  'bueroarbeit',
  'fehlerbehebung',
])

/** Normalisiert für den Vergleich: klein, Umlaute aufgelöst, ohne Trennzeichen. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Ist dieser Kandidat gesperrt? Vergleicht den GANZEN Namen, nicht Teilwörter —
 * sonst fiele „Lock-in (Anbieterbindung)" über „Anbieter" mit heraus.
 */
export function isExcludedGlossaryTerm(name: string): boolean {
  return EXCLUDED_GLOSSARY_TERMS.has(normalize(name))
}
