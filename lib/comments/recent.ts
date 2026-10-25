/**
 * Neue Leser-Takes der letzten Stunden für die Info-Box auf der
 * Admin-Startseite (Betreiber-Wunsch 2026-10-25).
 *
 * WARUM: In zweieinhalb Monaten kam genau ein Leser-Take an, und er fiel erst
 * bei einer Datenbank-Abfrage auf. Diese Liste beantwortet auf einen Blick
 * „ist etwas gekommen, und wo?" — Artikel und Abschnitt.
 *
 * Unbestätigte Magic-Link-Einträge (`pending_verify`) zählen nicht: hinter
 * ihnen steht noch kein bestätigter Mensch. Alles andere (veröffentlicht,
 * wartet auf Moderation, abgelehnt) wird gezeigt, mit Status.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import type { PostSource } from '@/lib/comments/service'

type AdminClient = ReturnType<typeof createAdminClient>

export const EXCERPT_CHARS = 160

export interface RecentComment {
  id: string
  createdAt: string
  status: string
  displayName: string
  excerpt: string
  postSource: PostSource
  postId: string
  postTitle: string | null
  postSlug: string | null
  sectionAnchor: string | null
  sectionHeadline: string | null
}

export interface RecentComments {
  hours: number
  /** Untere Grenze des Fensters, ISO. */
  since: string
  comments: RecentComment[]
}

function textOf(node: unknown): string {
  const n = node as { type?: string; text?: string; content?: unknown[] } | null
  if (!n) return ''
  if (n.type === 'text') return n.text ?? ''
  return (n.content ?? []).map(textOf).join('')
}

/**
 * Abschnitts-Überschrift aus dem Artikel-Content: die H2, deren `queueItemId`
 * dem Anker des Kommentars entspricht (so verankert das Take-Barometer die
 * Kommentare). Die Tabelle trägt die Überschrift oft nicht — beim einzigen
 * Kommentar bis 2026-10-25 war das Feld leer.
 */
export function resolveSectionHeadline(content: unknown, anchor: string | null): string | null {
  if (!anchor) return null
  const parsed = typeof content === 'string'
    ? (() => { try { return JSON.parse(content) } catch { return null } })()
    : content
  const nodes = (parsed as { content?: unknown[] } | null)?.content
  if (!Array.isArray(nodes)) return null
  const hit = nodes.find((n) => {
    const node = n as { type?: string; attrs?: Record<string, unknown> }
    return node.type === 'heading' && node.attrs?.queueItemId === anchor
  })
  const text = hit ? textOf(hit).trim() : ''
  return text || null
}

function excerpt(body: string): string {
  const s = body.trim()
  return s.length > EXCERPT_CHARS ? `${s.slice(0, EXCERPT_CHARS).trimEnd()}…` : s
}

export async function listRecentComments(
  supabase: AdminClient,
  opts: { hours: number; now?: Date; limit?: number },
): Promise<RecentComments> {
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - opts.hours * 3_600_000).toISOString()

  const { data, error } = await supabase
    .from('post_comments')
    .select('id, post_source, post_id, display_name, body, section_anchor, section_headline, status, created_at')
    .gte('created_at', since)
    .neq('status', 'pending_verify')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50)
  if (error) throw new Error(`Kommentare nicht ladbar: ${error.message}`)

  type Row = {
    id: string; post_source: PostSource; post_id: string; display_name: string; body: string
    section_anchor: string | null; section_headline: string | null; status: string; created_at: string
  }
  const rows = (data ?? []) as Row[]

  // Artikel je Quelle nachladen — Titel, Slug und (für die Abschnitts-
  // Überschrift) der Content der generierten Posts.
  type PostRow = { id: string; slug: string; title: string; content?: unknown }
  const posts = new Map<string, PostRow>()
  for (const source of ['generated_posts', 'posts'] as const) {
    const ids = [...new Set(rows.filter((r) => r.post_source === source).map((r) => r.post_id))]
    if (ids.length === 0) continue
    const { data: found } = await supabase
      .from(source)
      .select(source === 'generated_posts' ? 'id, slug, title, content' : 'id, slug, title')
      .in('id', ids)
    for (const p of (found ?? []) as unknown as PostRow[]) posts.set(`${source}:${p.id}`, p)
  }

  return {
    hours: opts.hours,
    since,
    comments: rows.map((r) => {
      const post = posts.get(`${r.post_source}:${r.post_id}`)
      return {
        id: r.id,
        createdAt: r.created_at,
        status: r.status,
        displayName: r.display_name,
        excerpt: excerpt(r.body),
        postSource: r.post_source,
        postId: r.post_id,
        postTitle: post?.title ?? null,
        postSlug: post?.slug ?? null,
        sectionAnchor: r.section_anchor,
        sectionHeadline: r.section_headline?.trim() || resolveSectionHeadline(post?.content, r.section_anchor),
      }
    }),
  }
}
