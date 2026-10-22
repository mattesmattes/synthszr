/**
 * Eigener Take-Durchgang mit deterministischer Prüfung (Stufe 4 der
 * Take-Reform, 2026-10-19).
 *
 * Bis dahin schrieb EIN Abschnitts-Aufruf Überschrift, Zusammenfassung und
 * Take zusammen; der Take bekam einen Bruchteil der Aufmerksamkeit und keine
 * Kontrolle außer Satzschnitt und „Wer"-Rewrite. Jetzt entsteht er in einem
 * zweiten Aufruf aus der fertigen Zusammenfassung, dem Blickwinkel, den
 * Vorbildern (take-exemplars) und dem Quellenauszug, wird gegen Wortbudget,
 * belegte Zahlen und Verbote geprüft und bei Verstoß genau EINMAL gezielt
 * umgeschrieben — danach greifen capTake und enforceTakeEnding wie bisher.
 * Rein (keine DB, kein SDK): der Modellaufruf wird injiziert, damit alles
 * ohne API testbar bleibt.
 *
 * 2026-10-21 (Betreiber: „verschachtelt, nicht flüssig, zu viele Regeln für
 * wenig Sätze"): Prompt von 4.100 auf 2.100 Zeichen gekürzt, Stimme in vier
 * Sätzen statt Skill-Spiegel, Verbote auf eine Zeile, neue Regel LESBARKEIT
 * (ein Gedanke pro Satz, Beobachtung → Grund → Folge). Die Zahl-Pflicht in
 * validateTake ist gestrichen; A/B an cron-211026: 15–17 statt 19–26 Wörter
 * je Satz.
 * 2026-10-22 (Betreiber: „nicht aus Analystenperspektive, Flughöhe stimmt
 * nicht"): Abschnitt PERSPEKTIVE ergänzt. Die Rolle war seit dem Wegfall
 * des Skeletts nirgends definiert; ein operativer Blickwinkel („spart
 * Arbeitszeit, wenn weniger Fehler") zog den Take auf Nutzer-Ebene.
 */
import { countWords, splitSentences, TAKE_MAX_WORDS } from '@/lib/claude/take-cap'

export const TAKE_MIN_WORDS = 45

export const TAKE_SYSTEM_PROMPT = `Du schreibst NUR den Synthszr Take: den Kommentar-Absatz unter einer fertigen Nachrichten-Zusammenfassung im Synthszr Newsletter, in der Stimme von Matthias „Mattes" Schrader (Digital-Praktiker, Gründer von SinnerSchrader und OH-SO Digital). Direkte Sprache, scharfe Diagnose, keine Ich-Perspektive, kein LinkedIn-Pathos, keine Erwähnung eigener Bücher.

STIMME: Schreib wie ein scharf denkender Mensch, der etwas zu sagen hat. Komm sofort zum Punkt, der erste Satz ist der stärkste. Humor durch Präzision, nicht durch Witze: ein unerwartet konkretes Detail aus der Nachricht statt eines Adjektivs. Ein kurzer Einschub in Klammern ist erlaubt (so wie hier), mehr nicht. Keine Gedankenstriche, kein Fettdruck, keine Aufzählung.

PERSPEKTIVE: Du schreibst als Analyst für Leser, die über Produkte, Budgets und Strategie entscheiden. Der Take beantwortet: Was bedeutet die Nachricht für den Markt, für die Strategie des Akteurs und seiner Wettbewerber, für die, die darauf bauen? Flughöhe sind Unternehmen, Geschäftsmodelle und Märkte, nicht der Alltag eines einzelnen Nutzers und keine ausgedachte Szene. Ein konkretes Beispiel belegt das Argument, es ersetzt es nicht.

ARGUMENT: Der Leser hat die Zusammenfassung gerade gelesen. Erzähl sie nicht nach; nimm nur die Fakten, die dein Argument braucht. Führe EIN Argument zu Ende, statt drei anzureißen. Zahlen nur, wenn sie in Zusammenfassung oder Quellenauszug stehen; ein Take ohne Zahl ist in Ordnung, eine erfundene nicht. Ist ein BLICKWINKEL vorgegeben, ist der Typ vor dem Doppelpunkt deine Linse; sie ändert die Flughöhe nicht.

LESBARKEIT: Ein Gedanke pro Satz. Die Argumentation läuft in einer Linie, jeder Satz knüpft an den vorigen an: Beobachtung, Grund, Folge. Keine Schachtelsätze, kein Nebensatz im Nebensatz, keine Faktenliste im Relativsatz. Wer den Take einmal liest, kann das Argument nachsprechen.

FORM: 50 bis 75 Wörter, ein Absatz. Satzzahl und Rhythmus sind frei, nicht in jedem Take dasselbe Muster.

NICHT: „Das ist nicht X, sondern Y" und jede Variante, die ein Framing erst aufbaut, um es zu ersetzen (sag Y direkt). Kein Auftakt mit „Der eigentliche …", „Das Spannende …", „Das ist bemerkenswert", „Genau deshalb". Kein Schlusssatz, der mit „Wer" beginnt. Kein „ehrlich", kein „drumherum", kein „Es bleibt abzuwarten", keine Anrede an „Führungskräfte" oder „Entscheider", keine Floskeln wie „Gamechanger", „darüber hinaus", „es ist wichtig zu beachten". Nicht als Pointe: „das Modell wird zur Commodity, der Wert wandert".

AUSGABE: Nur der Absatz, ohne „Synthszr Take:"-Präfix, ohne Anführungszeichen, ohne Erklärung.`

export interface TakeInput {
  heading: string
  summary: string
  sourceExcerpt: string
  takeAngle?: string
  exemplarsBlock?: string
  mattesBlock?: string
}

export function buildTakeUserPrompt(input: TakeInput): string {
  const parts = [
    `ÜBERSCHRIFT: ${input.heading}`,
    `ZUSAMMENFASSUNG (steht bereits über dem Take — nicht wiederholen):\n${input.summary.trim()}`,
  ]
  if (input.takeAngle) parts.push(`BLICKWINKEL: ${input.takeAngle}`)
  parts.push(`QUELLENAUSZUG (nur für Zahlen und Namen):\n<newsletter_quellmaterial>\n${input.sourceExcerpt.trim() || 'Kein Auszug verfügbar.'}\n</newsletter_quellmaterial>`)
  if (input.mattesBlock) parts.push(input.mattesBlock)
  if (input.exemplarsBlock) parts.push(input.exemplarsBlock)
  parts.push('Schreibe jetzt den Take.')
  return parts.join('\n\n')
}

function buildCorrectionPrompt(input: TakeInput, previous: string, problems: string[]): string {
  return `${buildTakeUserPrompt(input)}

KORREKTUR: Dein erster Take hat die Prüfung nicht bestanden.
BISHERIGER TAKE:
${previous}

PROBLEME:
${problems.map((p) => `- ${p}`).join('\n')}

Schreibe den vollständigen Take neu und behebe GENAU diese Punkte; Aussage und Haltung bleiben. Nur der Absatz.`
}

export interface TakeCheck { ok: boolean; problems: string[] }

const NUMBER_RE = /\d+(?:[.,]\d+)*/g
const FORBIDDEN_OPENERS = [
  /^(Der|Die|Das) eigentliche\b/,
  /^(Die|Das) (eigentlich )?(spannende|interessante)\b/,
  /^Das ist (wichtig|bedeutend|bemerkenswert|spannend)\b/,
  /^Genau (deshalb|da|hier)\b/,
]
const WER_RE = /^[^\p{L}]*Wer\b/u

const normalizeNumber = (n: string) => n.replace(/\./g, '')
const excerpt = (s: string) => s.split(/\s+/).slice(0, 6).join(' ') + (countWords(s) > 6 ? ' …' : '')

/** Deterministische Prüfung eines Takes gegen Form, Belege und Verbote. `facts` = Zusammenfassung + Quelle. */
export function validateTake(take: string, facts: string): TakeCheck {
  const problems: string[] = []
  const text = take.trim()
  const words = countWords(text)
  if (words < TAKE_MIN_WORDS) problems.push(`zu kurz: ${words} Wörter (Ziel 50 bis 75)`)
  if (words > TAKE_MAX_WORDS) problems.push(`zu lang: ${words} Wörter (Ziel 50 bis 75)`)

  // Keine Vorgaben zu Satzzahl, Satzlänge, Rhythmus oder Doppelpunkten (Betreiber
  // 2026-10-20: „keine Satzstrukturvorgaben, um Abwechslung zu ermöglichen"); das
  // Skelett (Mechanismus/Konsequenz/Prüfstein) hat der Betreiber am selben Tag
  // gestrichen, mit ihm die Skelett-Wort- und die Prognose-Prüfung. Die Sätze
  // dienen hier nur noch als Einheit für Auftakt- und Schluss-Prüfung.
  const sentences = splitSentences(text)
  if (/\s[—–]\s/.test(text)) problems.push('Gedankenstrich als Satzteiler')

  const factNumbers = new Set((facts.match(NUMBER_RE) ?? []).map(normalizeNumber))
  const takeNumbers = text.match(NUMBER_RE) ?? []
  for (const n of takeNumbers) {
    if (!factNumbers.has(normalizeNumber(n))) problems.push(`Zahl ohne Beleg: ${n}`)
  }

  const first = sentences[0] ?? text
  if (FORBIDDEN_OPENERS.some((re) => re.test(first))) problems.push(`verbotener Auftakt: „${excerpt(first)}"`)
  if (sentences.slice(-2).some((s) => WER_RE.test(s))) problems.push('"Wer …"-Schlussfigur im letzten oder vorletzten Satz')
  if (/\behrlich/i.test(text)) problems.push('das Wort „ehrlich"')
  if (/drumherum/i.test(text)) problems.push('„drumherum"-Verortung')

  return { ok: problems.length === 0, problems }
}

const TAKE_MARKER = /(^|\n)(\*\*)?Synthszr Take:(\*\*)?\s*/i

/**
 * Zusammenfassung eines Abschnitts für den Take-Durchgang: alles zwischen
 * Überschrift und Take-Marker ohne Tag-/Quellenzeilen, HTML-Kommentare und
 * Markdown-Links — das Modell soll Fakten lesen, keine Formatzeilen.
 */
export function summaryForTakePass(section: string): string {
  const m = section.match(TAKE_MARKER)
  const body = m && m.index !== undefined ? section.slice(0, m.index) : section
  return body
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (!t) return true                 // Leerzeilen bleiben: Absatzgrenzen
      if (t.startsWith('#')) return false
      if (/^(\{[^}]+\}\s*)+(→.*)?$/.test(t)) return false   // Company-Tag-Zeile (mit oder ohne Quellenpfeil)
      if (/\]\(https?:\/\//.test(t) && t.length < 200) return false  // Quellen-/Linkzeilen
      if (/^<!--.*-->$/.test(t)) return false
      return true
    })
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Ersetzt den Take-Absatz eines Abschnitts (bis zur nächsten Leerzeile); Marker und Markup danach bleiben. */
export function replaceTake(section: string, newTake: string): string {
  const m = section.match(TAKE_MARKER)
  if (!m || m.index === undefined) return section
  const beginn = m.index + m[0].length
  const rest = section.slice(beginn)
  const ende = rest.search(/\n\s*\n/)
  const prefix = section.slice(0, beginn).replace(/\s*$/, ' ')
  return prefix + newTake.trim() + (ende === -1 ? '' : rest.slice(ende))
}

/** Modellantwort säubern: Präfix, Anführungszeichen, Markdown-Fett. */
function cleanTake(raw: string): string {
  return raw.trim()
    .replace(/^\*{0,2}Synthszr Take:\*{0,2}\s*/i, '')
    .replace(/^["„“]+|["“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export type TakeCall = (user: string, system: string, opts: { correction: boolean }) => Promise<string>

export interface TakeResult {
  /** null, wenn der Modellaufruf scheiterte — der Aufrufer behält dann den Take des Abschnitts-Aufrufs. */
  take: string | null
  attempts: number
  problems: string[]
}

/** Erster Durchgang, Prüfung, höchstens eine gezielte Korrektur; wirft nie. */
export async function writeTake(input: TakeInput, deps: { call: TakeCall }): Promise<TakeResult> {
  const facts = `${input.summary}\n${input.sourceExcerpt}\n${input.heading}`
  try {
    const first = cleanTake(await deps.call(buildTakeUserPrompt(input), TAKE_SYSTEM_PROMPT, { correction: false }))
    const v1 = validateTake(first, facts)
    if (v1.ok) return { take: first, attempts: 1, problems: [] }

    const second = cleanTake(await deps.call(buildCorrectionPrompt(input, first, v1.problems), TAKE_SYSTEM_PROMPT, { correction: true }))
    const v2 = validateTake(second, facts)
    if (v2.ok) return { take: second, attempts: 2, problems: [] }
    return v2.problems.length <= v1.problems.length
      ? { take: second, attempts: 2, problems: v2.problems }
      : { take: first, attempts: 2, problems: v1.problems }
  } catch (err) {
    console.warn('[TakePass] Modellaufruf fehlgeschlagen — Take des Abschnitts bleibt:', err instanceof Error ? err.message : err)
    return { take: null, attempts: 0, problems: [err instanceof Error ? err.message : String(err)] }
  }
}
