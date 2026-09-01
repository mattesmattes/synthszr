/**
 * Gemeinsamer Katalog wiederkehrender KI-Stil-Muster ("AI-Tells"), die an
 * DREI unabhaengigen Stellen der Schreib-Pipeline verhindert bzw. korrigiert
 * werden: SECTION_SYSTEM_PROMPT (Erstgenerierung), PROOFREADING_PROMPT
 * (nachtraegliches Lektorat, beide lib/claude/ghostwriter-pipeline.ts) und
 * ANTI_LLM_STYLE_RULES (lib/enrich/style-rules.ts, Enrich-Rewrite).
 *
 * Bis 2026-09-01 hatte jede der drei Stellen ihre EIGENE Kopie dieser Listen,
 * im Detail leicht auseinandergedriftet (z.B. "X ist nicht Y, X ist Z" in
 * der Generierung vs. "X ist nicht Y, sondern Z" im Lektorat — dieselbe
 * Absicht, unterschiedlicher Wortlaut, kein Abgleich beim Bearbeiten). Dieses
 * Modul ist die EINE Quelle fuer die konkreten Beispiel-Muster; jede der drei
 * Stellen baut daraus ihre eigene, kontextpassende Anweisung (Verbot bei der
 * Generierung, Korrekturanweisung beim Lektorat, kompakte Fassung bei
 * Enrich) — der WORTLAUT der Beispiele selbst ist jetzt identisch.
 *
 * Neue Muster HIER ergaenzen, nicht in einer der drei Prompt-Dateien direkt
 * — sonst drifted es beim naechsten Fund wieder auseinander.
 */

/** "Kontrast-Konstruktion" / Negations-Reframe — das staerkste AI-Tell laut
 *  SECTION_SYSTEM_PROMPT: ein Framing aufbauen, um es zu negieren und durch
 *  ein "tieferes" zu ersetzen. Union aus allen drei bisherigen Einzellisten. */
export const NEGATION_REFRAME_PATTERNS = [
  'Das ist kein X, sondern Y.',
  'Das ist kein X mehr, sondern Y.',
  'Das ist nicht X. Das ist Y.',
  'Nicht X. Y.',
  'Vergiss X. Das ist Y.',
  'Weniger X, mehr Y.',
  'X ist nicht Y, sondern Z.',
  'Was wie X aussieht, ist eigentlich Y.',
  'nicht mehr X, sondern Y.',
]

/** Ersatz fuer Em-Dashes (— oder –) als Satzteiler — in allen drei Stellen
 *  bereits nahezu wortgleich, jetzt exakt. */
export const EM_DASH_REPLACEMENT = 'Punkt, Komma, Doppelpunkt, Semikolon oder Klammer'

/** Leere Verstaerker-Adverbien, die nichts zur Aussage hinzufuegen. */
export const FILLER_ADVERBS = ['exakt', 'zufällig', 'buchstäblich', 'tatsächlich', 'letztendlich']

/** Mechanische Uebergangsfloskeln — bisher nur in ANTI_LLM_STYLE_RULES. */
export const DEAD_TRANSITIONS = [
  'darüber hinaus',
  'zusätzlich',
  'außerdem (wenn mechanisch)',
  'anders gesagt',
  'es versteht sich von selbst',
]

/** Generische "tote KI-Sprache" — Union aus SECTION_SYSTEM_PROMPT (kuerzer)
 *  und ANTI_LLM_STYLE_RULES (laenger). */
export const DEAD_AI_PHRASES = [
  'In der heutigen [Thema]-Welt',
  'Es ist wichtig zu beachten, dass',
  'Es ist erwähnenswert',
  'Gamechanger',
  'bahnbrechend',
  'unkompliziert',
]

/** Leere Business-Floskeln — bisher nur in ANTI_LLM_STYLE_RULES. */
export const BUSINESS_FLUFF = [
  'nutzen/einsetzen als leeres Füllwort',
  'Umfeld/Sphäre/robust im Marketing-Sinn',
]

/** Beschreibung der "Wer …"-Schlussfigur — bisher nur in
 *  SECTION_SYSTEM_PROMPT und PROOFREADING_PROMPT, nicht in Enrich. */
export const WER_ENDING_DESCRIPTION =
  'Der letzte oder vorletzte Satz eines Synthszr Takes beginnt mit "Wer" (Konditional-Belehrung wie "Wer jetzt noch X tut/glaubt/hält/plant/baut, sollte/kann/verliert/gewinnt Y").'
