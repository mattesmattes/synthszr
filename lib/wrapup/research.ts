/**
 * Update-Recherche für den Wochenrückblick (Spec 2026-10-24).
 *
 * Je Thema der Woche EIN Aufruf mit dem Anthropic-Server-Tool web_search,
 * parallel über alle Themen (Muster: lib/rankings/research.ts). Gefragt wird
 * nicht „gibt es Berichte?", sondern „hat sich die Story NACH dem Tagesartikel
 * weiterentwickelt?" — Reaktion, Korrektur, Folgeentscheidung, neue Zahl.
 *
 * Die Quellen-Prüfung ist der eigentliche Schutz: Eine Quelle zählt nur mit
 * Datum zwischen Artikeldatum (exklusiv) und Stichtag (inklusiv). Ohne eine
 * solche Quelle ist das Ergebnis `none`, egal was das Modell behauptet —
 * sonst meldete es die Original-Nachricht aus einem anderen Medium als
 * Entwicklung.
 *
 * Fehler sind hier nie fatal: ein gescheitertes Thema ergibt `none`, der
 * Wrap-Up entsteht trotzdem (Spec: Grenzen).
 */
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { WrapupTopic } from '@/lib/wrapup/collect'
import { getModelCapabilities } from '@/lib/claude/model-capabilities'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { withUsageLogging } from '@/lib/ai/usage-log'

export type UpdateLevel = 'none' | 'minor' | 'major'

export interface UpdateSource {
  url: string
  title: string
  /** YYYY-MM-DD */
  date: string
}

export interface TopicUpdate {
  weekday: string
  updateLevel: UpdateLevel
  /** Belegte Entwicklung seit dem Tagesartikel, 2-5 Sätze; '' bei none. */
  summary: string
  sources: UpdateSource[]
  /** usage.server_tool_use.web_search_requests der Antwort; 0 bei Fehler. */
  searches: number
}

export interface ResearchClient {
  messages: { create(params: unknown, options?: unknown): Promise<unknown> }
}

const RESEARCH_TIMEOUT_MS = 90_000
const MAX_SEARCHES = 4
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function noUpdate(weekday: string): TopicUpdate {
  return { weekday, updateLevel: 'none', summary: '', sources: [], searches: 0 }
}

const SourceSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  date: z.string().optional(),
})
const ReportSchema = z.object({
  updateLevel: z.enum(['none', 'minor', 'major']),
  summary: z.string().optional(),
  sources: z.array(z.unknown()).optional(),
})

/** Entfernt web_search-Citation-Markup (<cite …>…</cite>); der zitierte Text bleibt. */
function stripCite(s: string): string {
  return s.replace(/<\/?cite[^>]*>/g, '').trim()
}

/**
 * Pure: prüft die Modellantwort gegen die Datumsschranke. Liefert nur dann
 * eine Stufe ungleich `none`, wenn mindestens eine Quelle NACH `articleDate`
 * und nicht nach `asOfDate` datiert ist und eine Zusammenfassung vorliegt.
 */
export function parseResearchResponse(
  raw: unknown,
  articleDate: string,
  asOfDate: string,
): Pick<TopicUpdate, 'updateLevel' | 'summary' | 'sources'> {
  const none = { updateLevel: 'none' as const, summary: '', sources: [] as UpdateSource[] }
  const outer = ReportSchema.safeParse(raw)
  if (!outer.success || outer.data.updateLevel === 'none') return none

  const sources: UpdateSource[] = []
  for (const s of outer.data.sources ?? []) {
    const p = SourceSchema.safeParse(s)
    if (!p.success) continue
    const url = p.data.url.trim()
    const date = p.data.date?.trim() ?? ''
    if (!/^https?:\/\//i.test(url)) continue
    // ISO-Datumsstrings vergleichen sich lexikographisch korrekt.
    if (!DATE_RE.test(date) || date <= articleDate || date > asOfDate) continue
    sources.push({ url, title: stripCite(p.data.title ?? '') || url, date })
  }
  if (sources.length === 0) return none

  const summary = stripCite(outer.data.summary ?? '')
  if (!summary) return none
  return { updateLevel: outer.data.updateLevel, summary, sources }
}

export function buildResearchPrompt(topic: WrapupTopic, asOfDate: string): string {
  return `Prüfe per WEB-SUCHE, ob sich diese Nachricht aus dem KI-Newsletter Synthszr seit ihrem Erscheinen weiterentwickelt hat.

NACHRICHT vom ${topic.date} (${topic.weekday}): ${topic.headline}

BERICHT (Stand ${topic.date}):
${topic.body}

URSPRÜNGLICHER SYNTHSZR TAKE:
${topic.takeText || '(keiner)'}

STICHTAG: ${asOfDate}. Gesucht sind ausschließlich Entwicklungen NACH dem ${topic.date} und bis zum ${asOfDate}.

WAS ALS UPDATE ZÄHLT: ein NEUER Sachverhalt — Reaktion eines Beteiligten, Korrektur, Dementi, Folgeentscheidung, Gegenangebot, neue Zahl, Marktreaktion, Regulierungsschritt. Dieselbe Nachricht in einem anderen Medium ist KEIN Update. Hintergrundartikel ohne neuen Sachverhalt sind KEIN Update.

STUFEN:
- none: nichts Neues gefunden. Das ist der Normalfall — lieber none als ein konstruiertes Update.
- minor: ein neuer Sachverhalt, der die Einschätzung des ursprünglichen Takes nicht verändert (mehr Berichterstattung allein ist höchstens minor).
- major: das Update verändert die Einschätzung des Takes, oder die Story bekommt einen neuen Hauptakteur, eine Entscheidung oder eine Zahl in anderer Größenordnung.

VORGEHEN: Suche gezielt nach der Story und ihren Akteuren mit Zeitbezug (z. B. "<Akteur> <Thema>" und "<Akteur> <Thema> reaction" / "update" / "Stellungnahme"). Höchstens ${MAX_SEARCHES} Suchen.

ANTWORT NUR über das Tool report_update:
- updateLevel: none | minor | major
- summary: auf DEUTSCH, 2-5 Sätze. Der erste Satz nennt, was wann passiert ist (Datum oder Akteur). Nur belegte Fakten, keine Wertung, keine Vermutung. Leer bei none.
- sources: je Quelle url, title und date im Format YYYY-MM-DD (Veröffentlichungsdatum der Quelle). Nur Quellen mit Datum NACH dem ${topic.date}. Ohne solche Quelle: updateLevel none.`
}

const REPORT_UPDATE_TOOL = {
  name: 'report_update',
  description: 'Melde, ob und wie sich die Nachricht seit dem Tagesartikel weiterentwickelt hat',
  input_schema: {
    type: 'object' as const,
    properties: {
      updateLevel: { type: 'string', enum: ['none', 'minor', 'major'] },
      summary: { type: 'string', description: 'Belegte Entwicklung auf Deutsch, 2-5 Sätze; leer bei none' },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            title: { type: 'string' },
            date: { type: 'string', description: 'Veröffentlichungsdatum YYYY-MM-DD' },
          },
          required: ['url', 'title', 'date'],
        },
      },
    },
    required: ['updateLevel', 'summary', 'sources'],
  },
}

/**
 * Recherche für EIN Thema. Scheitert der Aufruf (Timeout, Overload,
 * Verweigerung), ist das Ergebnis `none` — nie ein Fehler nach oben.
 */
export async function researchTopicUpdate(
  topic: WrapupTopic,
  opts: { model: string; asOfDate: string; client: ResearchClient; timeoutMs?: number },
): Promise<TopicUpdate> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? RESEARCH_TIMEOUT_MS)
  try {
    const params: Record<string, unknown> = {
      model: opts.model,
      max_tokens: 3000,
      // KEIN tool_choice: Server-Tools wie web_search verlangen `auto`.
      tools: [REPORT_UPDATE_TOOL, { type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }],
      messages: [{ role: 'user', content: buildResearchPrompt(topic, opts.asOfDate) }],
    }
    // Reine Web-Extraktion braucht kein Reasoning — Thinking aus, wo das Modell es verträgt.
    if (getModelCapabilities(opts.model).supportsDisabledThinking) params.thinking = { type: 'disabled' }

    const resp = (await opts.client.messages.create(params, { signal: controller.signal })) as {
      content?: Array<{ type: string; name?: string; input?: unknown }>
      usage?: { server_tool_use?: { web_search_requests?: number } }
    }
    const block = [...(resp.content ?? [])].reverse()
      .find((b) => b.type === 'tool_use' && b.name === 'report_update')
    const parsed = parseResearchResponse(block?.input ?? null, topic.date, opts.asOfDate)
    return {
      weekday: topic.weekday,
      ...parsed,
      searches: resp.usage?.server_tool_use?.web_search_requests ?? 0,
    }
  } catch (err) {
    console.error(
      `[WeekWrapup] Recherche ${topic.weekday} fehlgeschlagen:`,
      err instanceof Error ? `${err.name}: ${err.message}` : err,
    )
    return noUpdate(topic.weekday)
  } finally {
    clearTimeout(timer)
  }
}

function berlinToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date())
}

/**
 * Recherche für alle Themen der Woche, parallel. Ohne API-Key: überall `none`
 * (einmal gewarnt), damit Tests und Umgebungen ohne Schlüssel den Wrap-Up
 * weiter bauen können.
 */
export async function researchWeekUpdates(
  topics: WrapupTopic[],
  opts: { asOfDate?: string; model?: string } = {},
): Promise<TopicUpdate[]> {
  if (topics.length === 0) return []
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[WeekWrapup] Recherche übersprungen: ANTHROPIC_API_KEY fehlt')
    return topics.map((t) => noUpdate(t.weekday))
  }
  const client = withUsageLogging(new Anthropic({ apiKey }), 'wrapup_research') as unknown as ResearchClient
  const model = opts.model ?? (await getModelForUseCase('wrapup_research'))
  const asOfDate = opts.asOfDate ?? berlinToday()
  return Promise.all(topics.map((t) => researchTopicUpdate(t, { model, asOfDate, client })))
}
