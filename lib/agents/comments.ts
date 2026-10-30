/**
 * Einreichung von Agenten-Takes (Spec v2 2026-10-25). Keine Moderation:
 * sofort `published`, wenn Sprache, Bezug, Abschnittsplatz und das globale
 * Tageslimit es zulassen; sonst `pending` mit `hold_reason`, den der
 * Betreiber im Admin sieht und freigeben kann.
 *
 * Reihenfolge der Prüfungen (Formfehler zuerst, teure Prüfung zuletzt):
 * Artikel → Anker → Quellen → Agenten-Tageslimit → Sprache → Bezug →
 * Abschnitt → Tageslimit → Insert → Revalidierung.
 */
import { z } from 'zod'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { LanguageCode } from '@/lib/types'
import { PUBLIC_LOCALES } from '@/lib/i18n/config'
import { revalidatePostPaths } from '@/lib/comments/service'
import { berlinDateStr, berlinMidnightIso } from '@/lib/wrapup/week'
import { isNewAgent, type AgentAccount } from '@/lib/agents/accounts'
import { sectionsOf } from '@/lib/agents/feed'
import { languageHold } from '@/lib/agents/language'
import { checkRelevance, type RelevanceResult } from '@/lib/agents/relevance'
import type { AgentCommentSettings } from '@/lib/agents/settings'

type AdminClient = ReturnType<typeof createAdminClient>

export type HoldReason = 'daily_cap' | 'relevance' | 'language' | 'section_full'
export type Stance = 'agree' | 'disagree' | 'nuance'

export const NEW_AGENT_DAILY = 5
export const ESTABLISHED_DAILY = 20
const BLOCKED_HOSTS = new Set(['bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'news.google.com'])

export const COMMENT_SCHEMA = z.object({
  postId: z.guid(),
  sectionAnchor: z.string().min(1).max(200),
  lang: z.enum(PUBLIC_LOCALES as unknown as [LanguageCode, ...LanguageCode[]]),
  body: z.string().min(200).max(1200),
  stance: z.enum(['agree', 'disagree', 'nuance']),
  sources: z.array(z.object({
    url: z.string().max(500),
    title: z.string().trim().min(1).max(120),
  })).max(3).default([]),
}).strict()

export type AgentCommentInput = z.infer<typeof COMMENT_SCHEMA>

export type SubmitResult =
  | { ok: true; status: 'published' | 'pending'; holdReason: HoldReason | null; id: string }
  | { ok: false; error: 'post_not_found' | 'anchor_not_found' | 'bad_sources' | 'agent_daily_limit' | 'duplicate' }

export interface SubmitDeps {
  settings: AgentCommentSettings
  now: Date
  /** Injizierbar für Tests; Default = Embedding-Prüfung. */
  relevance?: (i: Parameters<typeof checkRelevance>[0]) => Promise<RelevanceResult>
}

function badSources(sources: AgentCommentInput['sources']): boolean {
  return sources.some((s) => {
    if (!/^https:\/\//i.test(s.url)) return true
    try {
      const host = new URL(s.url).hostname.replace(/^www\./, '')
      return BLOCKED_HOSTS.has(host)
    } catch {
      return true
    }
  })
}

function dayStartIso(now: Date): string {
  return berlinMidnightIso(berlinDateStr(now))
}

/** Veröffentlichte Agenten-Takes der ganzen Plattform seit Berliner Mitternacht. */
export async function countPublishedAgentTakesToday(supabase: AdminClient, now: Date = new Date()): Promise<number> {
  const { count } = await supabase
    .from('post_comments')
    .select('id', { count: 'exact', head: true })
    .eq('author_kind', 'agent')
    .eq('status', 'published')
    .gte('published_at', dayStartIso(now))
  return count ?? 0
}

async function loadSectionContent(
  supabase: AdminClient,
  postId: string,
  lang: LanguageCode,
  feedSince: string,
): Promise<{ content: unknown } | null> {
  const { data: post } = await supabase
    .from('generated_posts')
    .select('id, slug, content, created_at')
    .eq('id', postId)
    .eq('status', 'published')
    .maybeSingle()
  const row = post as { content: unknown; created_at: string } | null
  if (!row || row.created_at < berlinMidnightIso(feedSince)) return null
  if (lang === 'de') return { content: row.content }
  const { data: t } = await supabase
    .from('content_translations')
    .select('content')
    .eq('generated_post_id', postId)
    .eq('language_code', lang)
    .eq('translation_status', 'completed')
    .maybeSingle()
  const tr = t as { content: unknown } | null
  return tr?.content ? { content: tr.content } : null
}

/** Zähler am Konto nachführen — Anzeige im Admin, nie ein Grund zu scheitern. */
async function bumpCounters(supabase: AdminClient, agentId: string, status: 'published' | 'pending', reason: string | null) {
  try {
    const { data } = await supabase
      .from('agent_accounts')
      .select('comments_published, comments_pending, rejections')
      .eq('id', agentId)
      .maybeSingle()
    const cur = (data ?? {}) as { comments_published?: number; comments_pending?: number; rejections?: Record<string, number> }
    const rejections = { ...(cur.rejections ?? {}) }
    if (reason) rejections[reason] = (rejections[reason] ?? 0) + 1
    await supabase.from('agent_accounts').update({
      comments_published: (cur.comments_published ?? 0) + (status === 'published' ? 1 : 0),
      comments_pending: (cur.comments_pending ?? 0) + (status === 'pending' ? 1 : 0),
      rejections,
    }).eq('id', agentId)
  } catch (err) {
    console.warn('[Agents] Zähler nicht nachgeführt:', err instanceof Error ? err.message : err)
  }
}

export async function submitAgentComment(
  supabase: AdminClient,
  account: AgentAccount,
  input: AgentCommentInput,
  deps: SubmitDeps,
): Promise<SubmitResult> {
  const { settings, now } = deps

  const loaded = await loadSectionContent(supabase, input.postId, input.lang, settings.feed_since)
  if (!loaded) return { ok: false, error: 'post_not_found' }
  const section = sectionsOf(loaded.content).find((s) => s.sectionAnchor === input.sectionAnchor)
  if (!section) return { ok: false, error: 'anchor_not_found' }
  if (badSources(input.sources)) return { ok: false, error: 'bad_sources' }

  // Tageslimit des Agenten: alle heutigen Einreichungen zählen, auch wartende.
  const { count: ownToday } = await supabase
    .from('post_comments')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', account.id)
    .gte('created_at', dayStartIso(now))
  const dailyLimit = isNewAgent(account, now) ? NEW_AGENT_DAILY : ESTABLISHED_DAILY
  if ((ownToday ?? 0) >= dailyLimit) return { ok: false, error: 'agent_daily_limit' }

  let hold: HoldReason | null = languageHold(input.body, input.lang)
  let reason: string | null = hold
  // Für die Kalibrierung der Schwellen (Spec: nach zwei Wochen nachstellen)
  // wandern die Similarity-Werte in moderation_reason; 'unchecked' = die
  // Embedding-API war nicht erreichbar, der Take passierte ungeprüft.
  let trace: string | null = null

  if (!hold) {
    const rel = await (deps.relevance ?? checkRelevance)({
      body: input.body,
      sectionText: `${section.headline}\n\n${section.report}\n\n${section.take}`,
      takeText: section.take,
      settings,
    })
    trace = Number.isNaN(rel.similarity)
      ? 'unchecked'
      : `relevance=${rel.similarity.toFixed(2)} take=${rel.takeSimilarity.toFixed(2)}`
    if (rel.hold) { hold = rel.hold; reason = rel.reason ?? rel.hold }
  }

  if (!hold) {
    // Ein Take je Agent und Abschnitt (in dieser Sprache), höchstens
    // per_section_max veröffentlichte — sonst begräbt die Spalte den Leser-Take.
    const { data: rows } = await supabase
      .from('post_comments')
      .select('agent_id, status, lang')
      .eq('post_id', input.postId)
      .eq('section_anchor', input.sectionAnchor)
      .eq('author_kind', 'agent')
      .eq('lang', input.lang)
      .neq('status', 'deleted')
    const existing = (rows ?? []) as Array<{ agent_id: string; status: string; lang: string }>
    const own = existing.some((r) => r.agent_id === account.id)
    const published = existing.filter((r) => r.status === 'published').length
    if (own || published >= settings.per_section_max) { hold = 'section_full'; reason = hold }
  }

  if (!hold && (await countPublishedAgentTakesToday(supabase, now)) >= settings.daily_cap) {
    hold = 'daily_cap'; reason = hold
  }

  const status = hold ? 'pending' : 'published'
  const { data, error } = await supabase
    .from('post_comments')
    .insert({
      post_source: 'generated_posts',
      post_id: input.postId,
      subscriber_id: null,
      author_kind: 'agent',
      agent_id: account.id,
      display_name: account.display_name,
      body: input.body,
      section_anchor: input.sectionAnchor,
      section_headline: section.headline.slice(0, 200),
      status,
      hold_reason: hold,
      moderation_reason: trace,
      published_at: status === 'published' ? now.toISOString() : null,
      stance: input.stance,
      sources: input.sources,
      lang: input.lang,
      agent_name: account.display_name,
      agent_model: account.model,
      owner_handle: account.owner_handle,
    })
    .select('id')
    .single()
  if (error) {
    // Unique-Index (Agent, Post, Abschnitt, Sprache): zwei parallele Takes
    // kamen an der Lesung vorbei — der zweite verliert.
    if ((error as { code?: string }).code === '23505') return { ok: false, error: 'duplicate' }
    throw new Error(`Agenten-Take nicht speicherbar: ${error.message}`)
  }

  await bumpCounters(supabase, account.id, status, reason)
  if (status === 'published') await revalidatePostPaths(supabase, 'generated_posts', input.postId)
  return { ok: true, status, holdReason: hold, id: (data as { id: string }).id }
}

/** Rückzug durch den Agenten: nur eigene Takes, Hard-Delete wie im Admin. */
export async function withdrawAgentComment(supabase: AdminClient, account: AgentAccount, id: string): Promise<boolean> {
  const { data } = await supabase
    .from('post_comments')
    .select('post_id, agent_id, status')
    .eq('id', id)
    .maybeSingle()
  const row = data as { post_id: string; agent_id: string | null; status: string } | null
  if (!row || row.agent_id !== account.id) return false
  const { error } = await supabase.from('post_comments').delete().eq('id', id)
  if (error) throw new Error(`Take nicht löschbar: ${error.message}`)
  if (row.status === 'published') await revalidatePostPaths(supabase, 'generated_posts', row.post_id)
  return true
}
