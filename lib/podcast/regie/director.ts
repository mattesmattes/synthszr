/**
 * Regisseur der Tagesregie: füllt die vom Sampler gewählten Koordinaten mit
 * den heutigen Meldungen (welche Geschichte den Streit bekommt, gegen wen Emma
 * loslegt, wo welches Stilmittel sitzt). Ein kurzer Modellaufruf über ein
 * Tool (Use Case `podcast_regie`, Default Sonnet 5), fail-soft: Scheitert er,
 * gilt die Regie ohne konkrete Ausgestaltung.
 *
 * Der Regisseur schreibt keine Dialogzeilen, nur knappe Anweisungen; die
 * Ausgabe wird gegen den Artikel geprüft (Personen und Firmen müssen darin
 * vorkommen), damit die Regie keine Fakten einschleust.
 */
import { option, type AxisId } from '@/lib/podcast/regie/catalog'
import type { RegieCoordinates } from '@/lib/podcast/regie/sampler'

export interface RegieFill {
  fight: { story: string; conflict: string } | null
  rants: Array<{ story: string; target: string; charge: string }>
  devicePlans: Array<{ device: string; story: string; idea: string }>
  quickStories: string[]
  segmentPlan: string | null
}

export const REGIE_TOOL = {
  name: 'report_regie',
  description: 'Meldet die konkrete Regie für die heutige Folge',
  input_schema: {
    type: 'object' as const,
    properties: {
      fight: {
        type: 'object',
        description: 'The main disagreement of the episode',
        properties: {
          story: { type: 'string', description: 'Which story (short headline)' },
          conflict: { type: 'string', description: 'What exactly they disagree about, max 25 words' },
        },
        required: ['story', 'conflict'],
      },
      rants: {
        type: 'array',
        description: "Emma's two or three rants",
        items: {
          type: 'object',
          properties: {
            story: { type: 'string' },
            target: { type: 'string', description: 'A person or company named in the article' },
            charge: { type: 'string', description: 'What she accuses them of, supported by the article, max 25 words' },
          },
          required: ['story', 'target', 'charge'],
        },
      },
      device_plans: {
        type: 'array',
        description: "One entry per device active today",
        items: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Device id exactly as given' },
            story: { type: 'string' },
            idea: { type: 'string', description: 'Where and how it happens, max 25 words, no dialogue lines' },
          },
          required: ['device', 'story', 'idea'],
        },
      },
      quick_stories: { type: 'array', items: { type: 'string' }, description: 'Stories to treat briefly' },
      segment_plan: { type: 'string', description: 'How the pre-ending segment plays out today, max 30 words' },
    },
    required: ['fight', 'rants', 'device_plans', 'segment_plan'],
  },
}

const MAX_CONTENT_CHARS = 14_000

/** Die heutigen Koordinaten als englische Liste (der Regisseur arbeitet auf Englisch). */
export function describeCoordinates(coords: RegieCoordinates): string {
  const line = (id: AxisId) => (coords.picks[id] ?? []).map((pid) => {
    const opt = option(id, pid)
    return opt ? `${pid}: ${opt.text.en}` : pid
  }).join('\n  ')
  return [
    `- Shape of the episode: ${line('dramaturgy')}`,
    `- Temperature: ${line('temperature')}`,
    `- Devices active today (exactly these):\n  ${line('devices')}`,
    `- Comparisons from: ${coords.picks.imagery.map((pid) => option('imagery', pid)?.text.en ?? pid).join(' and ')}`,
    `- Pre-ending segment: ${line('segment')}`,
    `- Language: ${line('coarseness')}`,
    ...(coords.picks.ending?.length ? [`- Ending: ${line('ending')}`] : []),
  ].join('\n')
}

export function buildDirectorPrompt(input: { title: string; content: string; coords: RegieCoordinates }): string {
  return `You are the episode director of "Synthesizer Daily", a daily two-voice tech and business podcast. HOST Emma is a hot-tempered veteran tech reporter; GUEST Synthesizer is a provocative business professor with a big ego. The writers will turn your directions into dialogue.

Today's direction was chosen by rotation (do not change it):
${describeCoordinates(input.coords)}

Your job: make it concrete for today's article.
- fight: the story and the exact point where they clash (for "agreement day", the one disagreement that blows up).
- rants: two or three targets for Emma's rants, each a person or company that is named in the article, with the charge she makes; the charge must be supported by the article.
- device_plans: one entry per active device, using the device id exactly as listed, saying in which story and how it happens.
- quick_stories: the stories that should go by fast.
- segment_plan: how the pre-ending segment plays out today.

Rules: use only people, companies, numbers and events that appear in the article; write short directions, never dialogue lines or jokes; no more than 25 words per field.

Today's article:
---
Title: ${input.title}

${input.content.slice(0, MAX_CONTENT_CHARS)}
---

Answer only through the tool ${REGIE_TOOL.name}.`
}

const clip = (s: unknown, n = 220): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '')

/**
 * Prüft die Antwort des Regisseurs gegen den Artikel und die aktiven Mittel.
 * Ziele, die im Artikel nicht vorkommen, und unbekannte Mittel fallen weg.
 * `null`, wenn nichts Brauchbares übrig bleibt.
 */
export function parseRegieFill(raw: unknown, ctx: { content: string; coords: RegieCoordinates }): RegieFill | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const haystack = ctx.content.toLowerCase()
  const active = new Set(ctx.coords.picks.devices)

  const f = r.fight as Record<string, unknown> | undefined
  const fight = f && clip(f.story) && clip(f.conflict) ? { story: clip(f.story), conflict: clip(f.conflict) } : null

  const rants = (Array.isArray(r.rants) ? r.rants : [])
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({ story: clip(x.story), target: clip(x.target, 80), charge: clip(x.charge) }))
    .filter((x) => x.target && x.charge && targetInArticle(x.target, haystack))
    .slice(0, 3)

  const devicePlans = (Array.isArray(r.device_plans) ? r.device_plans : [])
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({ device: clip(x.device, 40), story: clip(x.story), idea: clip(x.idea) }))
    .filter((x) => active.has(x.device) && x.idea)
    .filter((x, i, arr) => arr.findIndex((y) => y.device === x.device) === i)

  const quickStories = (Array.isArray(r.quick_stories) ? r.quick_stories : []).map((x) => clip(x, 120)).filter(Boolean).slice(0, 5)
  const segmentPlan = clip(r.segment_plan) || null

  if (!fight && rants.length === 0 && devicePlans.length === 0) return null
  return { fight, rants, devicePlans, quickStories, segmentPlan }
}

/** Ein Ziel gilt als belegt, wenn sein Name (oder sein letztes Wort, etwa der Nachname) im Artikel steht. */
function targetInArticle(target: string, haystack: string): boolean {
  const t = target.toLowerCase().replace(/[’']s$/, '').trim()
  if (!t) return false
  if (haystack.includes(t)) return true
  const parts = t.split(/\s+/).filter((p) => p.length >= 4)
  return parts.length > 0 && parts.some((p) => haystack.includes(p))
}

/** Der Modellaufruf. Fail-soft: jeder Fehler ergibt `null`. */
export async function runDirector(input: { title: string; content: string; coords: RegieCoordinates }): Promise<RegieFill | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { getModelForUseCase } = await import('@/lib/ai/model-config')
    const { withUsageLogging } = await import('@/lib/ai/usage-log')
    const { createToolCall } = await import('@/lib/claude/tool-call')
    const client = withUsageLogging(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000 }), 'podcast_regie')
    const model = await getModelForUseCase('podcast_regie')
    const resp = await createToolCall(client, {
      model,
      max_tokens: 4096,
      tools: [REGIE_TOOL],
      tool_choice: { type: 'tool', name: REGIE_TOOL.name },
      messages: [{ role: 'user', content: buildDirectorPrompt(input) }],
    })
    const block = resp.content.find((b) => b.type === 'tool_use')
    const fill = parseRegieFill(block && 'input' in block ? block.input : null, { content: input.content, coords: input.coords })
    if (!fill) console.warn('[PodcastRegie] Regisseur ohne brauchbare Antwort, Regie ohne Ausgestaltung')
    return fill
  } catch (err) {
    console.warn('[PodcastRegie] Regisseur fehlgeschlagen (Regie ohne Ausgestaltung):', err instanceof Error ? err.message : err)
    return null
  }
}

/** Für die Admin-Antwort und Logs: welche Optionen heute gelten. */
export function summarizeCoordinates(coords: RegieCoordinates): Record<AxisId, string[]> {
  const out = {} as Record<AxisId, string[]>
  for (const id of Object.keys(coords.picks) as AxisId[]) {
    out[id] = (coords.picks[id] ?? []).map((pid) => option(id, pid)?.label.en ?? pid)
  }
  return out
}

