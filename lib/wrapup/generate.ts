/**
 * Erzeugt die NEUEN Teile des Wochenrückblicks.
 *
 * Das Modell schreibt hier NICHT den Bericht — der wird aus dem Tagesartikel
 * 1:1 übernommen, samt Quellenlinks und Lexikon-Verlinkungen (s. collect.ts).
 * Neu entsteht nur, was es im Original nicht gibt:
 *
 *   1. der Vorlauf über die große Linie der Woche,
 *   2. je Thema ein auf die Hälfte gekürzter Take,
 *   3. je Thema OPTIONAL ein Bezugs-Absatz, wenn es einen echten Bezug zu
 *      einem anderen Tag gibt.
 *
 * EIN Aufruf über alle Themen, nicht einer je Thema: Punkt 3 ist nur möglich,
 * wenn das Modell die ganze Woche gleichzeitig sieht.
 *
 * Strukturierte Ausgabe über ein Tool statt Fließtext-Markdown: die Teile
 * müssen einzeln in den TipTap-Baum eingesetzt werden, zwischen die
 * übernommenen Original-Knoten. Ein Markdown-Block ließe sich dafür nur über
 * Zeichenkettensuche wieder zerlegen.
 */
import Anthropic from '@anthropic-ai/sdk'
import { getModelCapabilities } from '@/lib/claude/model-capabilities'
import type { WrapupTopic } from '@/lib/wrapup/collect'

export interface WrapupParts {
  /** 3-4 Zeilen über die große Linie der Woche. */
  intro: string
  sections: Array<{
    weekday: string
    /** Gekürzter Take, 2-3 Sätze. */
    take: string
    /** Optionaler Bezugs-Absatz. Leer, wenn es keinen echten Bezug gibt. */
    bridge?: string
  }>
}

export const WRAPUP_SYSTEM_PROMPT = `Du schreibst den Wochenrückblick des KI-Newsletters Synthszr auf DEUTSCH.

Du bekommst die wichtigsten Nachrichten einer Woche, je eine pro Wochentag, im Volltext samt ihrem ursprünglichen Synthszr Take.

WICHTIG: Die BERICHTE werden unverändert übernommen. Du schreibst sie NICHT neu und kürzt sie NICHT. Du lieferst ausschließlich drei Dinge:

1. intro — 3-4 Zeilen über die große Linie der Woche. Was hat sich in der Summe verschoben? Keine Aufzählung der Themen, keine Ankündigung ("In dieser Woche lesen Sie…"), sondern eine These. Diese Zeilen stehen ganz oben, vor allen Nachrichten.

2. take — je Nachricht eine GEKÜRZTE Fassung ihres Synthszr Take: 2-3 Sätze statt der ursprünglichen 5-7. Sehr pointiert, klare Haltung, kein Referat des Berichts. Beginne NICHT mit "Synthszr Take:" — die Markierung wird automatisch gesetzt. Der Kern des Original-Takes bleibt erhalten, nur schärfer und kürzer.

3. bridge — NUR wo es einen ECHTEN Bezug zu einem anderen Tag dieser Woche gibt: ein einzelner Satz, der ihn benennt. Etwa wenn ein Thema am Mittwoch die Entwicklung vom Montag fortsetzt oder ihr widerspricht.
   ERFINDE KEINE BEZÜGE. Zwei Nachrichten über KI-Firmen haben nicht automatisch miteinander zu tun. Im Zweifel lässt du bridge leer — das ist der Normalfall, nicht die Ausnahme. Ein aufgesetzter Bezug ist schlimmer als keiner.

REGELN:
- Keine Zahlen, Namen oder Fakten erfinden. Alles steht in den Quelltexten.
- KEINE {Company}-Tags und KEINE {lex:}-Tags setzen. Die Verlinkung stammt aus den übernommenen Originaltexten.
- Keine Überschriften, keine Bullet Points, keine Markdown-Auszeichnung.`

const WRAPUP_TOOL = {
  name: 'report_wrapup',
  description: 'Vorlauf, gekürzte Takes und optionale Bezüge für den Wochenrückblick melden',
  input_schema: {
    type: 'object' as const,
    properties: {
      intro: { type: 'string', description: '3-4 Zeilen über die große Linie der Woche' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            weekday: { type: 'string', description: 'Wochentag, exakt wie vorgegeben' },
            take: { type: 'string', description: 'Gekürzter Take, 2-3 Sätze, ohne die Vorsilbe "Synthszr Take:"' },
            bridge: { type: 'string', description: 'Ein Satz zum Bezug auf einen anderen Tag. LEER lassen, wenn es keinen echten Bezug gibt.' },
          },
          required: ['weekday', 'take'],
        },
      },
    },
    required: ['intro', 'sections'],
  },
}

export function buildWrapupPrompt(topics: WrapupTopic[], weekLabel: string): string {
  const blocks = topics
    .map((t) => `### ${t.weekday} — ${t.headline}\n\nBERICHT:\n${t.body}\n\nURSPRÜNGLICHER TAKE:\n${t.takeText || '(keiner)'}`)
    .join('\n\n---\n\n')
  return `WOCHENRÜCKBLICK für den Zeitraum ${weekLabel}.

Diese ${topics.length} Nachrichten sind in dieser Woche erschienen, in dieser Reihenfolge:

<nachrichten>
${blocks}
</nachrichten>

Liefere über das Tool: den Vorlauf, und je Nachricht einen gekürzten Take sowie — nur wo ein echter Bezug besteht — einen Bezugssatz. Die Wochentage in deiner Antwort lauten exakt: ${topics.map((t) => t.weekday).join(', ')}.`
}

/**
 * Ruft das Modell und liefert die neu zu schreibenden Teile.
 *
 * Der Titel entsteht aus dem Zeitraum, nicht aus dem Modell: bei einem
 * Wochenrückblick ist er vorhersagbar.
 */
export async function generateWrapupParts(
  topics: WrapupTopic[],
  weekLabel: string,
  model: string,
): Promise<{ title: string; parts: WrapupParts }> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const { adaptiveThinking, supportsDisabledThinking } = getModelCapabilities(model)

  const params: Record<string, unknown> = {
    model,
    max_tokens: 8000,
    tools: [WRAPUP_TOOL],
    tool_choice: { type: 'tool', name: WRAPUP_TOOL.name },
    system: [{ type: 'text', text: WRAPUP_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: buildWrapupPrompt(topics, weekLabel) }],
  }
  // Thinking aus, wo das Modell es verträgt: die Aufgabe ist Kürzen und
  // Verbinden, kein Reasoning-Problem — und bei adaptivem Thinking deckt
  // max_tokens Denken UND Ausgabe gemeinsam ab. claude-fable-5 lehnt
  // 'disabled' mit HTTP 400 ab (s. model-capabilities.ts).
  if (adaptiveThinking && supportsDisabledThinking) params.thinking = { type: 'disabled' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await anthropic.messages.create(params as any)
  const block = res.content.find((b: { type: string }) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') {
    // Kein Tool-Block heißt: das Modell hat nicht geantwortet oder verweigert.
    // Beim Wrap-up hängt der ganze Post daran, deshalb hart scheitern statt
    // einen Entwurf ohne Takes anzulegen.
    throw new Error(
      `Modell lieferte keine verwertbare Antwort für den Wochenrückblick (stop_reason: ${res.stop_reason ?? 'unbekannt'})`,
    )
  }
  const parts = block.input as WrapupParts
  if (!parts?.intro || !Array.isArray(parts.sections)) {
    throw new Error('Antwort des Modells unvollständig: intro oder sections fehlen')
  }

  return { title: `AI-Week Wrap-up: ${weekLabel}`, parts }
}
