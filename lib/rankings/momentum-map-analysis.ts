/**
 * Generates and caches a crisp bilingual (EN + DE) editorial prose analysis
 * explaining WHY each monthly Momentum Map mover gained or lost relevance,
 * grounded strictly in cleaned news mentions from the last 30 days.
 *
 * Cached in `settings` under `momentum_map_analysis:<YYYY-MM>` so page loads
 * are instant and never trigger LLM calls on normal traffic.
 */
import { generateText } from 'ai'
import { google } from '@ai-sdk/google'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { escapeQuellmaterialTag, stripLoneSurrogates } from '@/lib/claude/sanitize'
import type { MonthlyMomentumReport, MomentumMover } from '@/lib/rankings/momentum-map'

export interface BilingualProse {
  en: string
  de: string
}

export interface CachedMomentumAnalysis {
  issueKey: string
  generatedAt: string
  summary: BilingualProse
  movers: Record<string, BilingualProse> // keyed by product slug
}

function cleanSnippet(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function analysisSettingsKey(monthLabel: string): string {
  return `momentum_map_analysis:${monthLabel.toLowerCase().replace(/\s+/g, '-')}`
}

export async function loadCachedMomentumAnalysis(monthLabel: string): Promise<CachedMomentumAnalysis | null> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', analysisSettingsKey(monthLabel))
      .maybeSingle()
    const val = (data as { value?: CachedMomentumAnalysis } | null)?.value
    if (val && typeof val === 'object' && val.movers && val.summary) {
      return val
    }
    return null
  } catch {
    return null
  }
}

function summarizeMoverForPrompt(m: MomentumMover, group: 'RISER' | 'NEW_ENTRANT' | 'COOLDOWN'): string {
  const evidenceLines = m.evidence
    .map((e, i) => `    [${i + 1}] (${e.date}) ${cleanSnippet(e.title)} — ${cleanSnippet(e.excerpt).slice(0, 220)}`)
    .join('\n')
  return `- SLUG: ${m.slug} | NAME: ${m.name} | VENDOR: ${m.vendor} | CATEGORY: ${m.categoryName} | GROUP: ${group}
  STATS: 30d avg ${m.prev30Avg} -> ${m.curr30Avg} (delta ${m.deltaAbs >= 0 ? '+' : ''}${m.deltaAbs}, ${m.deltaPct !== null ? `${m.deltaPct}%` : 'NEW'}, current ${m.currentMomentum})
  NEWS EVIDENCE:
${evidenceLines || '    (no recent excerpts available — base reasoning strictly on momentum shift & model/category lifecycle)'}`
}

export async function generateAndCacheMomentumAnalysis(
  monthLabel: string,
  report: MonthlyMomentumReport,
  opts: { force?: boolean } = {}
): Promise<CachedMomentumAnalysis | null> {
  if (!opts.force) {
    const existing = await loadCachedMomentumAnalysis(monthLabel)
    if (existing) return existing
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    return null
  }

  const allMovers: Array<{ mover: MomentumMover; group: 'RISER' | 'NEW_ENTRANT' | 'COOLDOWN' }> = [
    ...report.risers.map((mover) => ({ mover, group: 'RISER' as const })),
    ...report.newEntrants.map((mover) => ({ mover, group: 'NEW_ENTRANT' as const })),
    ...report.fallers.map((mover) => ({ mover, group: 'COOLDOWN' as const })),
  ]

  const material = escapeQuellmaterialTag(
    stripLoneSurrogates(allMovers.map(({ mover, group }) => summarizeMoverForPrompt(mover, group)).join('\n\n'))
  )

  const systemPrompt = `You are the senior editor of Synthszr, an analytical AI-tech briefing for decision makers.
Write sharp, concrete editorial prose explaining WHY each AI product became more or less relevant over the last 30 days compared to the prior 30 days.

RULES:
- Base every factual claim strictly on the news evidence inside <newsletter_quellmaterial>. Never invent launches, prices, or benchmark scores not present in the evidence.
- If evidence is sparse for a product (e.g. a newly released model version or a cooling predecessor), state concisely what the momentum shift and naming/category context show without fabricating facts.
- Never quote raw HTML tags or copy-paste messy headlines verbatim. Synthesize into fluent, crisp journalistic prose (2–3 sentences per product, ~45–65 words).
- Avoid AI clichés ("delve", "landscape", "game-changer", "testament", "reshaping"). Be direct, analytical, and concrete.
- Provide BOTH English ("en") and German ("de") versions.
- Return ONLY valid JSON matching the exact schema below, with no markdown fences or commentary.`

  const userPrompt = `Issue: SYNTHSZR MOMENTUM MAP · ${monthLabel} (${report.previousPeriodLabel} vs ${report.currentPeriodLabel})

<newsletter_quellmaterial>
${material}
</newsletter_quellmaterial>

Return JSON with this exact shape:
{
  "summary": {
    "en": "2-3 sentence editorial takeaway synthesizing the month's biggest structural shift across risers, new launches, and cool-downs.",
    "de": "2-3 Sätze redaktionelles Fazit auf Deutsch über die wichtigsten Verschiebungen des Monats."
  },
  "movers": {
    "<slug>": {
      "en": "2-3 sentences explaining specifically WHY this product gained or lost relevance this month based on the news evidence.",
      "de": "2-3 Sätze auf Deutsch, warum dieses Produkt im Vergleich zum Vormonat relevanter oder irrelevanter geworden ist."
    }
  }
}`

  let text = ''
  const errors: string[] = []

  // Provider fallback chain: Gemini -> Anthropic -> OpenAI
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY && !text) {
    try {
      const res = await generateText({
        model: google('gemini-3.8-flash'),
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 8192,
      })
      text = res.text
    } catch (err) {
      errors.push(`gemini: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (process.env.ANTHROPIC_API_KEY && !text) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      })
      text = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
    } catch (err) {
      errors.push(`anthropic: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (process.env.OPENAI_API_KEY && !text) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      text = json.choices?.[0]?.message?.content ?? ''
    } catch (err) {
      errors.push(`openai: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (!text) {
    console.error('[MomentumMap] All LLM providers failed:', errors.join(' | '))
    return null
  }

  const rawText = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')

  const parsed = JSON.parse(rawText) as { summary?: BilingualProse; movers?: Record<string, BilingualProse> }
  if (!parsed?.summary?.en || !parsed?.summary?.de || !parsed?.movers) {
    throw new Error('Invalid JSON structure from momentum-map analysis LLM')
  }

  const record: CachedMomentumAnalysis = {
    issueKey: analysisSettingsKey(monthLabel),
    generatedAt: new Date().toISOString(),
    summary: parsed.summary,
    movers: parsed.movers,
  }

  const supabase = createAdminClient()
  await supabase
    .from('settings')
    .upsert({ key: record.issueKey, value: record }, { onConflict: 'key' })

  return record
}
