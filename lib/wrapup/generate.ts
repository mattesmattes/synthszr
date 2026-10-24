/**
 * Erzeugt die NEUEN Teile des Wochenrückblicks.
 *
 * Das Modell schreibt hier NICHT den Bericht — der wird aus dem Tagesartikel
 * 1:1 übernommen, samt Quellenlinks und Lexikon-Verlinkungen (s. collect.ts).
 * Neu entsteht nur, was es im Original nicht gibt:
 *
 *   1. der Vorlauf über die große Linie der Woche (mit Teaser der Updates),
 *   2. je Thema ein auf die Hälfte gekürzter Take — ODER, wenn die Recherche
 *      (research.ts) eine Entwicklung seit dem Tagesartikel gefunden hat, ein
 *      „Synthszr Update" samt der Auswahl der Bericht-Absätze (keepParagraphs,
 *      nur bei major; assemble.ts lässt dann ganze Knoten weg, nie Sätze),
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
import { createToolCall } from '@/lib/claude/tool-call'
import { textOf, type WrapupTopic } from '@/lib/wrapup/collect'
import type { TopicUpdate } from '@/lib/wrapup/research'
import { withUsageLogging } from '@/lib/ai/usage-log'

export interface WrapupParts {
  /** 3-4 Zeilen über die große Linie der Woche. */
  intro: string
  /** Genau drei Mini-Headlines für die SEO-Beschreibung, je max 65 Zeichen —
   *  dasselbe Format wie plan.excerptBullets im Tagesartikel. */
  excerptBullets: string[]
  sections: Array<{
    weekday: string
    /** Gekürzter Take, 40-60 Wörter — nur für Themen ohne Update. */
    take?: string
    /** Synthszr Update (minor 40-60, major bis 120 Wörter) — ersetzt den Take. */
    update?: string
    /** Nur bei major: Indizes der Bericht-Knoten (bodyNodes), die bleiben. */
    keepParagraphs?: number[]
    /** Optionaler Bezugs-Absatz. Leer, wenn es keinen echten Bezug gibt. */
    bridge?: string
  }>
}

export const WRAPUP_SYSTEM_PROMPT = `Du schreibst den Wochenrückblick des KI-Newsletters Synthszr auf DEUTSCH.

Du bekommst die wichtigsten Nachrichten einer Woche, je eine pro Wochentag, im Volltext samt ihrem ursprünglichen Synthszr Take — und je Nachricht ein RECHERCHE-UPDATE: das Ergebnis einer Web-Recherche, ob sich die Story seit dem Tagesartikel weiterentwickelt hat (Stufe none, minor oder major, mit Zusammenfassung und datierten Quellen).

WICHTIG: Die BERICHTE werden unverändert übernommen. Du schreibst sie NICHT neu und kürzt sie NICHT satzweise; nur bei major entfallen ganze Absätze (Punkt 4). Du lieferst ausschließlich diese Dinge:

1. intro — 3-4 Zeilen über die große Linie der Woche. Was hat sich in der Summe verschoben? Keine Aufzählung der Themen, keine Ankündigung ("In dieser Woche lesen Sie…"), sondern eine These. Diese Zeilen stehen ganz oben, vor allen Nachrichten.
   Gibt es Nachrichten mit RECHERCHE-UPDATE (minor oder major), benennt das Intro in höchstens zwei Sätzen, welche Storys sich in der Woche bewegt haben und in welche Richtung. Keine Aufzählung, kein „mehr dazu unten". Ohne Updates kein Teaser.

2. take — NUR für Nachrichten mit "RECHERCHE-UPDATE: keines": eine GEKÜRZTE Fassung ihres Synthszr Take, 40 bis 60 Wörter (2-3 Sätze). Sehr pointiert, klare Haltung, kein Referat des Berichts. Beginne NICHT mit "Synthszr Take:" — die Markierung wird automatisch gesetzt. Der Kern des Original-Takes bleibt erhalten, nur schärfer und kürzer.

3. update — NUR für Nachrichten mit RECHERCHE-UPDATE der Stufe minor oder major. Das Update ersetzt den Take; liefere für diese Nachricht KEIN take.
   - minor: 40 bis 60 Wörter.
   - major: bis 120 Wörter.
   Der erste Satz nennt, was seit dem Tagesartikel passiert ist, mit Datum oder Akteur. Danach: Was heißt das für die ursprüngliche Einschätzung — bestätigt sie das oder kippt sie? Sag ausdrücklich, ob der ursprüngliche Take gehalten hat. Jede Zahl und jeder Fakt im Update stammt aus dem RECHERCHE-UPDATE, nichts aus eigenem Wissen. Analysten-Flughöhe wie im Take: Markt, Strategie, Geschäftsmodell. Beginne NICHT mit "Synthszr Update:" — die Markierung wird automatisch gesetzt.

4. keepParagraphs — NUR bei major. Der Bericht dieser Nachricht steht als nummerierte Absätze [0], [1], … Nenne die Indizes der Absätze, die im Rückblick bleiben; der Rest entfällt. [0] bleibt immer, mindestens zwei Absätze bleiben, Ziel etwa die Hälfte der Wörter. Absätze werden NICHT umformuliert, nur weggelassen — bevorzugt bleiben die, auf die das Update aufsetzt.

5. excerptBullets — GENAU DREI eigenständige Mini-Headlines für die SEO-Beschreibung, je höchstens 65 Zeichen, auf DEUTSCH. Jede soll für sich stehen und neugierig machen; zusammen decken sie die Woche ab. Keine Aufzählungszeichen davorsetzen.

6. bridge — NUR wo es einen ECHTEN Bezug zu einem anderen Tag dieser Woche gibt: ein einzelner Satz, der ihn benennt. Etwa wenn ein Thema am Mittwoch die Entwicklung vom Montag fortsetzt oder ihr widerspricht.
   ERFINDE KEINE BEZÜGE. Zwei Nachrichten über KI-Firmen haben nicht automatisch miteinander zu tun. Im Zweifel lässt du bridge leer — das ist der Normalfall, nicht die Ausnahme. Ein aufgesetzter Bezug ist schlimmer als keiner.

REGELN:
- Keine Zahlen, Namen oder Fakten erfinden. Alles steht in den Quelltexten oder im RECHERCHE-UPDATE.
- KEINE {Company}-Tags und KEINE {lex:}-Tags setzen. Die Verlinkung stammt aus den übernommenen Originaltexten.
- Keine Überschriften, keine Bullet Points, keine Markdown-Auszeichnung.`

export const WRAPUP_TOOL = {
  name: 'report_wrapup',
  description: 'Vorlauf, gekürzte Takes und optionale Bezüge für den Wochenrückblick melden',
  input_schema: {
    type: 'object' as const,
    properties: {
      intro: { type: 'string', description: '3-4 Zeilen über die große Linie der Woche' },
      excerptBullets: {
        type: 'array',
        items: { type: 'string' },
        description: 'Genau drei Mini-Headlines für die SEO-Beschreibung, je max 65 Zeichen, ohne Aufzählungszeichen',
      },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            weekday: { type: 'string', description: 'Wochentag, exakt wie vorgegeben' },
            take: { type: 'string', description: 'Nur ohne Update: gekürzter Take, 40-60 Wörter, ohne die Vorsilbe "Synthszr Take:"' },
            update: { type: 'string', description: 'Nur bei RECHERCHE-UPDATE minor/major: das Synthszr Update (minor 40-60, major bis 120 Wörter), ohne die Vorsilbe "Synthszr Update:"' },
            keepParagraphs: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Nur bei major: Indizes der nummerierten Bericht-Absätze, die bleiben ([0] immer, mindestens zwei).',
            },
            bridge: { type: 'string', description: 'Ein Satz zum Bezug auf einen anderen Tag. LEER lassen, wenn es keinen echten Bezug gibt.' },
          },
          required: ['weekday'],
        },
      },
    },
    required: ['intro', 'excerptBullets', 'sections'],
  },
}

/** Bericht als nummerierte Absätze — Index = Position in bodyNodes, damit
 *  keepParagraphs auf dieselben Knoten zeigt wie assemble.ts. Textlose Knoten
 *  (Bilder) behalten ihren Index und werden nur nicht gedruckt. */
function numberedBody(topic: WrapupTopic): string {
  return topic.bodyNodes
    .map((n, i) => ({ i, text: textOf(n).trim() }))
    .filter((x) => x.text.length > 0)
    .map((x) => `[${x.i}] ${x.text}`)
    .join('\n\n')
}

function updateBlock(update: TopicUpdate | undefined): string {
  if (!update || update.updateLevel === 'none') return 'RECHERCHE-UPDATE: keines'
  const quellen = update.sources.map((s) => `- ${s.title} (${s.date}) ${s.url}`).join('\n')
  return `RECHERCHE-UPDATE (Stufe: ${update.updateLevel}):\n${update.summary}\nQuellen:\n${quellen}`
}

export function buildWrapupPrompt(topics: WrapupTopic[], weekLabel: string, updates: TopicUpdate[] = []): string {
  const byWeekday = new Map(updates.map((u) => [u.weekday.trim().toLowerCase(), u]))
  const blocks = topics
    .map((t) => {
      const update = byWeekday.get(t.weekday.trim().toLowerCase())
      const major = update?.updateLevel === 'major'
      const bericht = major
        ? `BERICHT (nummerierte Absätze für keepParagraphs):\n${numberedBody(t)}`
        : `BERICHT:\n${t.body}`
      return `### ${t.weekday} — ${t.headline}\n\n${bericht}\n\nURSPRÜNGLICHER TAKE:\n${t.takeText || '(keiner)'}\n\n${updateBlock(update)}`
    })
    .join('\n\n---\n\n')
  return `WOCHENRÜCKBLICK für den Zeitraum ${weekLabel}.

Diese ${topics.length} Nachrichten sind in dieser Woche erschienen, in dieser Reihenfolge:

<nachrichten>
${blocks}
</nachrichten>

Liefere über das Tool: den Vorlauf, drei Excerpt-Bullets, und je Nachricht entweder einen gekürzten Take (RECHERCHE-UPDATE: keines) oder ein Update (Stufe minor/major; bei major zusätzlich keepParagraphs) sowie — nur wo ein echter Bezug besteht — einen Bezugssatz. Die Wochentage in deiner Antwort lauten exakt: ${topics.map((t) => t.weekday).join(', ')}.`
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
  updates: TopicUpdate[] = [],
): Promise<{ title: string; parts: WrapupParts }> {
  const anthropic = withUsageLogging(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), 'wrapup')
  const { adaptiveThinking, supportsDisabledThinking } = getModelCapabilities(model)

  const params: Record<string, unknown> = {
    model,
    max_tokens: 8000,
    tools: [WRAPUP_TOOL],
    tool_choice: { type: 'tool', name: WRAPUP_TOOL.name },
    system: [{ type: 'text', text: WRAPUP_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: buildWrapupPrompt(topics, weekLabel, updates) }],
  }
  // Thinking aus, wo das Modell es verträgt: die Aufgabe ist Kürzen und
  // Verbinden, kein Reasoning-Problem — und bei adaptivem Thinking deckt
  // max_tokens Denken UND Ausgabe gemeinsam ab. claude-fable-5 lehnt
  // 'disabled' mit HTTP 400 ab (s. model-capabilities.ts).
  if (adaptiveThinking && supportsDisabledThinking) params.thinking = { type: 'disabled' }

  // createToolCall: Opus 5.5 lehnt das erzwungene tool_choice oben mit HTTP 400
  // ab (Prod 2026-09-27) — dort wird auf auto umgestellt (s. tool-call.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await createToolCall(anthropic, params as any)
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

  return { title: `Die AI-Themen der Woche vom ${weekLabel}`, parts }
}
