/**
 * Erzeugt den Wochenrückblick aus den Themen der Woche.
 *
 * EIN Modellaufruf über alle Themen, nicht einer je Thema. Das ist die zentrale
 * Entscheidung des Designs und folgt direkt aus der Anforderung, dass sich die
 * Themen aufeinander beziehen sollen: Querbezüge entstehen nur, wenn das Modell
 * alle gleichzeitig sieht. Sechs getrennte Aufrufe könnten das strukturell
 * nicht — und wären dazu teurer.
 *
 * Die Kehrseite: es gibt kein Teilergebnis. Das ist vertretbar, weil ein
 * Wrap-up ohne Zusammenhang seinen Zweck verfehlt.
 */
import Anthropic from '@anthropic-ai/sdk'
import { getModelCapabilities } from '@/lib/claude/model-capabilities'
import { assertNonEmptyModelOutput } from '@/lib/claude/ghostwriter-pipeline'
import type { WrapupTopic } from '@/lib/wrapup/collect'

export const WRAPUP_SYSTEM_PROMPT = `Du schreibst den Wochenrückblick des KI-Newsletters Synthszr auf DEUTSCH.

Du bekommst die wichtigsten Nachrichten einer Woche, je eine pro Wochentag, im Volltext. Sie sind bereits erschienen. Deine Aufgabe ist NICHT, sie zu wiederholen, sondern sie aus dem Abstand einer Woche neu zu erzählen und miteinander zu verbinden.

AUFBAU — genau in dieser Reihenfolge:

1. VORLAUF: 3-4 Zeilen ohne Überschrift. Sie benennen die große Linie der Woche — was sich in der Summe verschoben hat. Keine Aufzählung der Themen, keine Ankündigung ("In dieser Woche lesen Sie…"), sondern eine These.

2. Danach je Nachricht ein Abschnitt in der vorgegebenen Reihenfolge:
   - Überschrift exakt wie vorgegeben ("## Wochentag — Original-Headline"). Nicht umformulieren, nicht kürzen.
   - 4-6 Sätze Bericht. NEU FORMULIERT und REFLEKTIERTER als das Original: Was am Tag selbst eine Meldung war, ist eine Woche später eine Entwicklung. Stelle QUERBEZÜGE zu den anderen Tagen her, wo es sie gibt — genau dafür siehst du alle Nachrichten gleichzeitig. Erfinde keine Bezüge, wo keine sind.
   - "Synthszr Take:" + 2-3 Sätze. SEHR kurz, sehr pointiert, eine klare Haltung. Kein Referat des Berichts darüber.

REGELN:
- Keine Zwischenüberschriften außer den vorgegebenen. Keine Bullet Points.
- Keine Zahlen, Namen oder Fakten erfinden. Alles steht in den Quelltexten.
- Der Take ist der einzige Ort für Wertung. Der Bericht bleibt Bericht.
- KEINE {Company}-Tags und KEINE {lex:}-Tags setzen — der Wrap-up verweist über die Originalartikel, doppelte Auszeichnung würde Ratings und Lexikonseiten erneut auslösen.`

/**
 * Baut den User-Prompt.
 *
 * Die Überschriften stehen WÖRTLICH als Liste im Prompt, nicht nur als Regel.
 * Das Modell soll sie übernehmen, nicht aus einer Beschreibung rekonstruieren —
 * die Form „Wochentag — Original-Headline" ist Betreiber-Vorgabe und muss exakt
 * stimmen, damit der Rückblick für Leser des Tagesartikels wiedererkennbar ist.
 */
export function buildWrapupPrompt(topics: WrapupTopic[], weekLabel: string): string {
  const blocks = topics
    .map((t) => `### ${t.weekday} — ${t.headline}\n\n${t.body}`)
    .join('\n\n---\n\n')
  const outline = topics.map((t) => `## ${t.weekday} — ${t.headline}`).join('\n')
  return `WOCHENRÜCKBLICK für den Zeitraum ${weekLabel}.

Diese ${topics.length} Nachrichten sind in dieser Woche erschienen, in dieser Reihenfolge:

<nachrichten>
${blocks}
</nachrichten>

Schreibe den Rückblick. Die Überschriften lauten EXAKT so, in dieser Reihenfolge:

${outline}

Beginne mit dem Vorlauf (3-4 Zeilen, keine Überschrift), dann die Abschnitte.`
}

/**
 * Ruft das Modell und liefert Titel und Markdown.
 *
 * Der Titel entsteht aus dem Zeitraum, nicht aus dem Modell: bei einem
 * Wochenrückblick ist er vorhersagbar, ein eigener Aufruf dafür wäre
 * verschwendet.
 */
export async function generateWrapup(
  topics: WrapupTopic[],
  weekLabel: string,
  model: string,
): Promise<{ title: string; markdown: string }> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const { adaptiveThinking, supportsDisabledThinking } = getModelCapabilities(model)

  const params: Record<string, unknown> = {
    model,
    max_tokens: 16000,
    system: [{ type: 'text', text: WRAPUP_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: buildWrapupPrompt(topics, weekLabel) }],
  }
  // Thinking bewusst AUS: die Aufgabe ist Umformulieren mit Querbezügen, kein
  // Reasoning-Problem — und bei adaptivem Thinking deckt max_tokens Denken UND
  // Text gemeinsam ab. Nur setzen, wo das Modell es verträgt: claude-fable-5
  // lehnt 'disabled' mit HTTP 400 ab (s. model-capabilities.ts).
  if (adaptiveThinking && supportsDisabledThinking) params.thinking = { type: 'disabled' }

  let text = ''
  let stopReason: string | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = anthropic.messages.stream(params as any)
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    } else if (event.type === 'message_delta') {
      stopReason = event.delta.stop_reason ?? stopReason
    }
  }
  // Ein Wrap-up hängt an EINEM Aufruf — ohne diese Prüfung landete eine
  // Verweigerung als leerer Entwurf in der Datenbank. Genau dieser Fall ist am
  // 2026-08-07 im Ghostwriter aufgetreten (s. reference_modell_verweigerung).
  assertNonEmptyModelOutput(text, `Wochenrückblick (${model})`, stopReason)

  return { title: `AI-Week Wrap-up: ${weekLabel}`, markdown: text.trim() }
}
