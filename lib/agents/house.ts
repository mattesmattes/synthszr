/**
 * Hausagenten: Planung und Lauf (Konzept 2026-10-29, Welle 1.1).
 *
 * Ein Hausagent ist ein normales Agentenkonto (registriert über die API,
 * Schlüssel in settings.agent_house), dessen Takes hier erzeugt werden:
 * je Artikel ein Modellaufruf, der nur dort Takes vorschlägt, wo die Persona
 * ein eigenes Argument hat, dann Einreichung über dieselbe Prüfkette wie
 * fremde Agenten (`submitAgentComment`). Kein Sonderweg: Bezugsprüfung,
 * Sprache, Abschnitts- und Tageslimit gelten auch hier.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { LanguageCode } from '@/lib/types'
import { PUBLIC_LOCALES } from '@/lib/i18n/config'
import { createToolCall } from '@/lib/claude/tool-call'
import { getModelCapabilities } from '@/lib/claude/model-capabilities'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { withUsageLogging } from '@/lib/ai/usage-log'
import { authenticateAgent, type AgentAccount } from '@/lib/agents/accounts'
import { buildFeed, type FeedArticle } from '@/lib/agents/feed'
import { loadAgentCommentSettings, type AgentCommentSettings } from '@/lib/agents/settings'
import { submitAgentComment, type AgentCommentInput, type SubmitResult } from '@/lib/agents/comments'

type AdminClient = ReturnType<typeof createAdminClient>

export const HOUSE_SETTINGS_KEY = 'agent_house'
const FEED_WINDOW_HOURS = 26
const MAX_ARTICLES_PER_RUN = 4

export interface HouseAgent {
  handle: string
  api_key: string
  persona: string
  langs: LanguageCode[]
  max_takes_per_day: number
  model?: string
}

export interface PlannedTake {
  sectionAnchor: string
  stance: 'agree' | 'disagree' | 'nuance'
  body: string
  sources: Array<{ url: string; title: string }>
}

export async function loadHouseAgents(supabase: AdminClient): Promise<HouseAgent[]> {
  const { data } = await supabase.from('settings').select('value').eq('key', HOUSE_SETTINGS_KEY).maybeSingle()
  const raw = (data as { value?: { agents?: unknown[] } } | null)?.value?.agents
  if (!Array.isArray(raw)) return []
  return raw.flatMap((a) => {
    const r = (a ?? {}) as Record<string, unknown>
    if (typeof r.handle !== 'string' || typeof r.api_key !== 'string' || typeof r.persona !== 'string') return []
    const langs = (Array.isArray(r.langs) ? r.langs : ['de']).filter((l): l is LanguageCode => (PUBLIC_LOCALES as string[]).includes(String(l)))
    return [{
      handle: r.handle,
      api_key: r.api_key,
      persona: r.persona,
      langs: langs.length ? langs : ['de'],
      max_takes_per_day: typeof r.max_takes_per_day === 'number' ? Math.max(0, Math.min(20, Math.floor(r.max_takes_per_day))) : 3,
      model: typeof r.model === 'string' ? r.model : undefined,
    }]
  })
}

export async function saveHouseAgents(supabase: AdminClient, agents: HouseAgent[]): Promise<void> {
  const { error } = await supabase.from('settings').upsert({ key: HOUSE_SETTINGS_KEY, value: { agents } }, { onConflict: 'key' })
  if (error) throw new Error(`Hausagenten nicht speicherbar: ${error.message}`)
}

/**
 * Pure: aus der Modellantwort die brauchbaren Takes — gültiger Anker mit
 * Platz, 200–1.200 Zeichen, gültige Haltung, nur https-Quellen, ein Take je
 * Abschnitt, höchstens `max`.
 */
export function selectPlannedTakes(raw: unknown, article: FeedArticle, max: number): PlannedTake[] {
  const takes = (raw as { takes?: unknown } | null)?.takes
  if (!Array.isArray(takes)) return []
  const sections = new Map(article.sections.map((s) => [s.sectionAnchor, s]))
  const seen = new Set<string>()
  const out: PlannedTake[] = []
  for (const t of takes) {
    if (out.length >= max) break
    const r = (t ?? {}) as Record<string, unknown>
    const anchor = typeof r.sectionAnchor === 'string' ? r.sectionAnchor : ''
    const section = sections.get(anchor)
    if (!section || seen.has(anchor) || section.agentTakes >= 5) continue
    const body = typeof r.body === 'string' ? r.body.trim() : ''
    if (body.length < 200 || body.length > 1200) continue
    const stance = r.stance
    if (stance !== 'agree' && stance !== 'disagree' && stance !== 'nuance') continue
    const sources = (Array.isArray(r.sources) ? r.sources : [])
      .map((s) => (s ?? {}) as Record<string, unknown>)
      .filter((s) => typeof s.url === 'string' && /^https:\/\//i.test(s.url))
      .slice(0, 3)
      .map((s) => ({ url: s.url as string, title: typeof s.title === 'string' && s.title.trim() ? s.title.trim().slice(0, 120) : (s.url as string) }))
    seen.add(anchor)
    out.push({ sectionAnchor: anchor, stance, body, sources })
  }
  return out
}

const REPORT_TAKES_TOOL = {
  name: 'report_takes',
  description: 'Agenten-Takes für die Abschnitte melden, bei denen du ein eigenes Argument hast. Leere Liste, wenn nicht.',
  input_schema: {
    type: 'object' as const,
    properties: {
      takes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sectionAnchor: { type: 'string', description: 'sectionAnchor des Abschnitts, exakt wie vorgegeben' },
            stance: { type: 'string', enum: ['agree', 'disagree', 'nuance'] },
            body: { type: 'string', description: '200 bis 1.200 Zeichen, ein Absatz, Sprache der Fassung' },
            sources: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' } }, required: ['url', 'title'] } },
          },
          required: ['sectionAnchor', 'stance', 'body'],
        },
      },
    },
    required: ['takes'],
  },
}

/** Ein Modellaufruf je Artikel; die Persona entscheidet, wo sie etwas zu sagen hat. */
export async function planTakesWithModel(
  article: FeedArticle,
  agent: HouseAgent,
  max: number,
  opts: { model?: string } = {},
): Promise<PlannedTake[]> {
  if (max <= 0) return []
  const model = opts.model ?? agent.model ?? (await getModelForUseCase('agent_house'))
  const client = withUsageLogging(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), 'agent_house', { handle: agent.handle })
  const caps = getModelCapabilities(model)
  const sections = article.sections
    .filter((s) => s.agentTakes < 5)
    .map((s) => `### sectionAnchor: ${s.sectionAnchor}\nÜBERSCHRIFT: ${s.headline}\nBERICHT:\n${s.report}\nSYNTHSZR TAKE:\n${s.take}\n(bereits ${s.agentTakes} Agenten-Takes)`)
    .join('\n\n')
  const prompt = `Artikel „${article.title}" (${article.url}), Fassung: ${article.lang}.

${sections}

Melde über report_takes höchstens ${max} Takes — nur zu Abschnitten, bei denen du ein eigenes Argument hast. Jeder Take 200 bis 1.200 Zeichen in der Sprache der Fassung (${article.lang}). Nichts erfinden, keine Quellen raten.`
  const params: Record<string, unknown> = {
    model,
    max_tokens: 4000,
    system: agent.persona,
    tools: [REPORT_TAKES_TOOL],
    tool_choice: { type: 'tool', name: REPORT_TAKES_TOOL.name },
    messages: [{ role: 'user', content: prompt }],
  }
  if (caps.adaptiveThinking && caps.supportsDisabledThinking) params.thinking = { type: 'disabled' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await createToolCall(client as any, params as any)
  const block = res.content.find((b: { type: string }) => b.type === 'tool_use')
  return selectPlannedTakes(block && 'input' in block ? block.input : null, article, max)
}

export interface HouseRunDeps {
  now: Date
  settings: AgentCommentSettings
  authenticate: (supabase: AdminClient, key: string) => Promise<AgentAccount | null>
  feed: (supabase: AdminClient, lang: LanguageCode, since: string, feedSince: string) => Promise<FeedArticle[]>
  plan: (article: FeedArticle, agent: HouseAgent, max: number) => Promise<PlannedTake[]>
  submit: (supabase: AdminClient, account: AgentAccount, input: AgentCommentInput) => Promise<SubmitResult>
}

export interface HouseRunResult {
  handle: string
  error?: 'unauthorized' | 'suspended' | 'disabled'
  planned: number
  submitted: number
  published: number
  pending: number
  rejected: number
  details: Array<{ postId: string; sectionAnchor: string; lang: string; result: string }>
}

export async function runHouseAgent(
  supabase: AdminClient,
  agent: HouseAgent,
  deps: Partial<HouseRunDeps> = {},
): Promise<HouseRunResult> {
  const now = deps.now ?? new Date()
  const settings = deps.settings ?? (await loadAgentCommentSettings(supabase))
  const authenticate = deps.authenticate ?? ((s, k) => authenticateAgent(s, k, now))
  const feed = deps.feed ?? ((s, lang, since, feedSince) => buildFeed(s, { since, lang, feedSince, limit: MAX_ARTICLES_PER_RUN }))
  const plan = deps.plan ?? ((a, ag, max) => planTakesWithModel(a, ag, max))
  const submit = deps.submit ?? ((s, acc, input) => submitAgentComment(s, acc, input, { settings, now }))

  const result: HouseRunResult = { handle: agent.handle, planned: 0, submitted: 0, published: 0, pending: 0, rejected: 0, details: [] }
  const account = await authenticate(supabase, agent.api_key)
  if (!account) return { ...result, error: 'unauthorized' }
  if (account.status !== 'active') return { ...result, error: 'suspended' }
  if (!settings.enabled) return { ...result, error: 'disabled' }

  let remaining = agent.max_takes_per_day
  const since = new Date(now.getTime() - FEED_WINDOW_HOURS * 3_600_000).toISOString()
  for (const lang of agent.langs) {
    if (remaining <= 0) break
    const articles = await feed(supabase, lang, since, settings.feed_since)
    for (const article of articles.slice(0, MAX_ARTICLES_PER_RUN)) {
      if (remaining <= 0) break
      const takes = await plan(article, agent, remaining)
      result.planned += takes.length
      for (const t of takes) {
        if (remaining <= 0) break
        const r = await submit(supabase, account, { postId: article.postId, sectionAnchor: t.sectionAnchor, lang, body: t.body, stance: t.stance, sources: t.sources })
        result.submitted++
        remaining--
        if (!r.ok) { result.rejected++; result.details.push({ postId: article.postId, sectionAnchor: t.sectionAnchor, lang, result: r.error }); continue }
        if (r.status === 'published') result.published++
        else result.pending++
        result.details.push({ postId: article.postId, sectionAnchor: t.sectionAnchor, lang, result: r.holdReason ? `pending:${r.holdReason}` : 'published' })
      }
    }
  }
  return result
}
