/**
 * Welche Anthropic-Parameterform ein Modell verträgt.
 *
 * Lag bis 2026-08-04 als Allowlist (`is2026Frontier`) inline in
 * ghostwriter-pipeline.ts. Ein Modell, das dort nicht eingetragen war, fiel in
 * den else-Zweig und bekam `thinking: { type: 'enabled', budget_tokens }` — was
 * die 2026er Modelle mit HTTP 400 ablehnen. Genau das passierte in Prod mit
 * claude-opus-5, nachdem es im Admin-UI auswählbar wurde: jeder Abschnitt des
 * Tages-Artikels wurde durch die Fehlermeldung ersetzt.
 *
 * DESHALB IST DIE LOGIK UMGEKEHRT ZUR INTUITION: nicht „welche Modelle sind
 * modern", sondern „welche sind noch alt". Der Fehlermodus ist asymmetrisch —
 *
 *   modernes Modell fälschlich als alt behandelt -> HTTP 400, kein Text
 *   altes Modell fälschlich als modern behandelt  -> denkt nicht, Text kommt
 *
 * — und eine Struktur, die bei Unwissen in den harmlosen Fehler läuft, ist der
 * Liste überlegen, die bei jedem neuen Modell gepflegt werden muss. Ein
 * unbekanntes Modell gilt hier also als modern.
 *
 * Die drei Fähigkeiten haben BEWUSST unterschiedliche Grenzen — sie wurden in
 * verschiedenen Modellgenerationen eingeführt und lassen sich nicht zu einem
 * Flag zusammenfassen. Opus 4.5 etwa braucht noch budget_tokens, kennt aber
 * schon effort.
 */

/** Modelle, die die ALTE Thinking-Form brauchen (`enabled` + `budget_tokens`). */
// ⚠️ Die Minor-Version muss mit (?!\d) abgeschlossen werden, NICHT mit \b: nach
// „claude-opus-4“ steht in „claude-opus-4-8“ eine Wortgrenze, ein \b hätte also
// auch 4.8 als Legacy eingeordnet und ihm budget_tokens gegeben — derselbe
// HTTP-400-Ausfall, den dieses Modul verhindern soll, nur mit anderem Auslöser.
const LEGACY_BUDGET_THINKING = [
  /^claude-3/,              // gesamte 3er-Familie
  /^claude-haiku-4/,        // Haiku 4.x kennt kein adaptives Thinking
  /^claude-sonnet-4-5/,
  /^claude-opus-4$/,        // undatiertes Opus 4.0
  /^claude-opus-4-[0-5](?!\d)/, // Opus 4.0 bis 4.5 — ab 4.6 adaptiv
]

/** Modelle ohne `output_config.effort`. Opus 4.5 fehlt hier bewusst: es ist das
 *  erste mit effort, obwohl es noch die alte Thinking-Form braucht. */
const NO_EFFORT_SUPPORT = [
  /^claude-3/,
  /^claude-haiku-4/,
  /^claude-sonnet-4-5/,
  /^claude-opus-4$/,
  /^claude-opus-4-[0-4](?!\d)/,
]

/** Modelle, die `temperature`/`top_p`/`top_k` noch AKZEPTIEREN. Ab Opus 4.7
 *  und in allen 2026ern führen diese Felder zu HTTP 400. */
const ACCEPTS_SAMPLING = [
  ...LEGACY_BUDGET_THINKING,
  /^claude-opus-4-6(?!\d)/,
  /^claude-sonnet-4-6/,
]

const matches = (patterns: RegExp[], id: string) => patterns.some((p) => p.test(id))

export interface ModelCapabilities {
  /** `thinking: { type: 'adaptive' }` statt `enabled` + `budget_tokens`. */
  adaptiveThinking: boolean
  /** `output_config: { effort }` wird unterstützt. */
  supportsEffort: boolean
  /** `temperature` & Co. würden mit HTTP 400 abgelehnt. */
  rejectsSampling: boolean
}

export function getModelCapabilities(modelId: string): ModelCapabilities {
  return {
    adaptiveThinking: !matches(LEGACY_BUDGET_THINKING, modelId),
    supportsEffort: !matches(NO_EFFORT_SUPPORT, modelId),
    rejectsSampling: !matches(ACCEPTS_SAMPLING, modelId),
  }
}
