/**
 * Feed für Agenten: veröffentlichte Artikel je Sprachfassung mit ihren
 * Abschnitten (Überschrift, Bericht, Take) und dem Anker, unter dem ein
 * Agenten-Take später auf der Seite erscheint.
 *
 * ANKER-REGEL = take-barometer.ts (s. sectionsOf). Nur mit identischer Regel
 * landet der Take des Agenten unter dem Take, den er gelesen hat — auch auf
 * übersetzten Seiten, deren H2 die ID verloren haben können.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import type { LanguageCode } from '@/lib/types'
import { textOf } from '@/lib/wrapup/collect'
import { berlinMidnightIso } from '@/lib/wrapup/week'

type AdminClient = ReturnType<typeof createAdminClient>

const SITE = 'https://www.synthszr.com'

export interface FeedSection {
  sectionAnchor: string
  headline: string
  report: string
  take: string
  /** Bereits veröffentlichte Agenten-Takes in dieser Sprache. */
  agentTakes: number
}

export interface FeedArticle {
  postId: string
  lang: LanguageCode
  title: string
  url: string
  publishedAt: string
  sections: FeedSection[]
}

type Node = { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }

/** Dieselben Marker wie take-barometer.ts: alle drei zählen im Index. */
const TAKE_MARKER_RE = /^\s*(Synthszr Take|Synthszr Update|Mattes Synthese)\s*:\s*/i

/**
 * Pure: Abschnitte eines TipTap-Dokuments mit EXAKT der Anker-Regel von
 * take-barometer.ts (Review 2026-10-26): der Anker ist die `queueItemId` der
 * letzten vorangehenden Überschrift MIT ID — ID-lose Überschriften werden
 * übersprungen —, sonst `idx:<n>` über alle Take-Absätze; doppelte Anker
 * (Wrap-up-Bündel teilen eine ID) bekommen `~2`, `~3` … Überschrift des
 * Abschnitts ist die nächstgelegene vorangehende Überschrift, mit oder ohne ID.
 */
export function sectionsOf(content: unknown): FeedSection[] {
  const parsed = typeof content === 'string'
    ? (() => { try { return JSON.parse(content) } catch { return null } })()
    : content
  const nodes = (parsed as { content?: Node[] } | null)?.content
  if (!Array.isArray(nodes)) return []

  const out: FeedSection[] = []
  let lastHeadline = ''
  let lastId: string | null = null
  let report: string[] = []
  let takeIndex = 0
  const seen = new Map<string, number>()

  for (const node of nodes) {
    if (node.type === 'heading') {
      lastHeadline = textOf(node).trim()
      const id = node.attrs?.queueItemId
      if (typeof id === 'string' && id) lastId = id
      report = []
      continue
    }
    const text = textOf(node).trim()
    if (!text) continue
    if (TAKE_MARKER_RE.test(text)) {
      const base = lastId ?? `idx:${takeIndex}`
      takeIndex++
      const occ = (seen.get(base) ?? 0) + 1
      seen.set(base, occ)
      out.push({
        sectionAnchor: occ > 1 ? `${base}~${occ}` : base,
        headline: lastHeadline,
        report: report.join('\n\n'),
        take: text.replace(TAKE_MARKER_RE, ''),
        agentTakes: 0,
      })
      report = []
      continue
    }
    report.push(text)
  }
  return out
}

export async function buildFeed(
  supabase: AdminClient,
  opts: { since: string; lang: LanguageCode; limit?: number; feedSince: string },
): Promise<FeedArticle[]> {
  const limit = Math.min(opts.limit ?? 20, 20)
  const floor = berlinMidnightIso(opts.feedSince)
  const since = opts.since > floor ? opts.since : floor

  const { data: posts, error } = await supabase
    .from('generated_posts')
    .select('id, slug, title, content, created_at')
    .eq('status', 'published')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Feed nicht ladbar: ${error.message}`)
  type Post = { id: string; slug: string; title: string; content: unknown; created_at: string }
  const rows = (posts ?? []) as Post[]
  if (rows.length === 0) return []

  // Übersetzte Fassung: Titel, Slug und Content aus content_translations.
  const translated = new Map<string, { slug: string; title: string; content: unknown }>()
  if (opts.lang !== 'de') {
    const { data } = await supabase
      .from('content_translations')
      .select('generated_post_id, slug, title, content')
      .in('generated_post_id', rows.map((r) => r.id))
      .eq('language_code', opts.lang)
      .eq('translation_status', 'completed')
    for (const t of (data ?? []) as Array<{ generated_post_id: string; slug: string | null; title: string | null; content: unknown }>) {
      if (t.slug && t.content) translated.set(t.generated_post_id, { slug: t.slug, title: t.title ?? '', content: t.content })
    }
  }

  // Vorhandene Agenten-Takes je Abschnitt in dieser Sprache.
  const counts = new Map<string, number>()
  const { data: existing } = await supabase
    .from('post_comments')
    .select('post_id, section_anchor')
    .in('post_id', rows.map((r) => r.id))
    .eq('author_kind', 'agent')
    .eq('status', 'published')
    .eq('lang', opts.lang)
  for (const c of (existing ?? []) as Array<{ post_id: string; section_anchor: string | null }>) {
    const k = `${c.post_id}:${c.section_anchor ?? ''}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }

  const articles: FeedArticle[] = []
  for (const post of rows) {
    const t = opts.lang === 'de' ? null : translated.get(post.id)
    if (opts.lang !== 'de' && !t) continue // keine fertige Fassung in dieser Sprache
    const sections = sectionsOf(t ? t.content : post.content)
      .map((s) => ({ ...s, agentTakes: counts.get(`${post.id}:${s.sectionAnchor}`) ?? 0 }))
    if (sections.length === 0) continue
    articles.push({
      postId: post.id,
      lang: opts.lang,
      title: t ? t.title : post.title,
      url: `${SITE}/${opts.lang}/posts/${t ? t.slug : post.slug}`,
      publishedAt: post.created_at,
      sections,
    })
  }
  return articles
}
