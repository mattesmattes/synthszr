/**
 * Eigene veröffentlichte Takes als Vorbilder für den Ghostwriter (Stufe 3 der
 * Take-Reform, 2026-10-19).
 *
 * Bis dahin bekam das Modell frühere Posts nur als Titel und Teaser
 * (historical-retrieval.ts, für Rückbezüge) und Code-Crash-Passagen als
 * Stimm-Anker. Was dem Betreiber tatsächlich durchgeht — 96 % der behaltenen
 * Takes veröffentlicht er wörtlich — sah es nie. Dieses Modul zieht aus den
 * thematisch nächsten veröffentlichten Posts die Take-Absätze, bewertet sie
 * nach Nähe zur Anfrage, Leser-Zustimmung (take_feedback; Anker = queueItemId
 * der H2, sonst idx:N wie im Take-Barometer) und Zielform (40–90 Wörter) und
 * gibt die besten drei als Prompt-Block aus.
 *
 * Kein eigener Index: die Kandidaten-Posts kommen aus demselben
 * match_generated_posts-Aufruf wie der historische Kontext, nur mit höherem
 * Limit — kein zweites Embedding je Abschnitt.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import type { PastPost } from '@/lib/posts/historical-retrieval'

export interface ExtractedTake { heading: string; anchor: string; take: string }

export interface ExemplarCandidate {
  postId: string
  title: string
  date: string
  heading: string
  anchor: string
  take: string
  agree: number
  disagree: number
}

// Kein s-Flag (tsconfig target ES6): [\s\S] statt dotAll.
const TAKE_RE = /^\s*Synthszr Take:\s*([\s\S]*)$/i

function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { text?: string; content?: unknown[] }
  const own = n.text ?? ''
  const kids = Array.isArray(n.content) ? n.content.map(textOf).join('') : ''
  return own + kids
}

/** H2-Abschnitte eines TipTap-Dokuments mit ihrem Take; Anker wie im Take-Barometer. */
export function extractTakes(doc: unknown): ExtractedTake[] {
  const content = (doc as { content?: unknown[] } | null)?.content
  if (!Array.isArray(content)) return []
  const out: ExtractedTake[] = []
  let current: { heading: string; queueItemId: string | null } | null = null
  let takeIndex = 0
  for (const raw of content) {
    const node = raw as { type?: string; attrs?: { level?: number; queueItemId?: string | null } }
    if (node.type === 'heading' && node.attrs?.level === 2) {
      current = { heading: textOf(node).trim(), queueItemId: node.attrs.queueItemId ?? null }
      continue
    }
    if (node.type !== 'paragraph' || !current) continue
    const m = textOf(node).match(TAKE_RE)
    if (!m) continue
    const anchor = current.queueItemId ?? `idx:${takeIndex}`
    takeIndex++
    out.push({ heading: current.heading, anchor, take: m[1].trim() })
    current = null // ein Take je Abschnitt
  }
  return out
}

const STOPWORDS = new Set(['eine', 'einer', 'eines', 'einem', 'einen', 'dass', 'nicht', 'sich', 'auch', 'wird', 'werden', 'wenn', 'aber', 'oder', 'noch', 'mehr', 'über', 'beim', 'dann', 'denn', 'dort', 'hier', 'ihre', 'ihrer', 'seine', 'seiner', 'diese', 'dieser', 'dieses', 'nach', 'statt', 'damit', 'dafür', 'dabei', 'schon', 'weil', 'sondern', 'zwischen', 'gegen', 'unter', 'ohne', 'kein', 'keine', 'sind', 'haben', 'macht', 'kommt', 'bleibt', 'heißt', 'muss', 'kann', 'soll', 'sollte', 'könnte', 'dürfte', 'wäre', 'the', 'and', 'with', 'from', 'that', 'this', 'into'])

function terms(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ')
      .map((w) => w.length > 6 ? w.slice(0, 6) : w) // grober Stamm
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
  )
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let hit = 0
  for (const t of a) if (b.has(t)) hit++
  return hit / Math.min(a.size, b.size)
}

const wordsOf = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0)

/** Bewertung eines Kandidaten gegen die Anfrage; < 0 heißt ausgeschlossen. */
export function scoreExemplar(c: ExemplarCandidate, queryTerms: Set<string>): number {
  const votes = c.agree + c.disagree
  const share = votes > 0 ? c.agree / votes : null
  if (votes >= 3 && share !== null && share < 0.4) return -1 // Leser widersprechen klar: kein Vorbild
  let score = overlap(terms(`${c.heading} ${c.take}`), queryTerms)
  if (votes >= 3 && share !== null && share >= 0.6) score += 0.15
  const w = wordsOf(c.take)
  if (w >= 40 && w <= 90) score += 0.1
  else if (w > 110) score -= 0.2
  return score
}

export function pickExemplars(cands: ExemplarCandidate[], query: string, limit = 3): ExemplarCandidate[] {
  const q = terms(query)
  return cands
    .map((c) => ({ c, s: scoreExemplar(c, q) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c)
}

export function formatExemplarTakesForPrompt(takes: ExemplarCandidate[]): string {
  if (takes.length === 0) return ''
  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) } catch { return iso.slice(0, 10) }
  }
  const lines = takes.map((t, i) => {
    const votes = t.agree + t.disagree
    const zustimmung = votes > 0 ? `, Zustimmung ${Math.round((100 * t.agree) / votes)} % bei ${votes} Votes` : ''
    return `[${i + 1}] „${t.title}" (${fmtDate(t.date)}), Abschnitt „${t.heading}"${zustimmung}:\n${t.take}`
  })
  return [
    'SO SCHREIBT MATTES SEINE TAKES (veröffentlichte Beispiele zu verwandten Themen — übernimm Haltung, Dichte und Satzbau, NICHT die Formulierungen, Zahlen oder Pointen; dein Take handelt von DIESER News):',
    ...lines,
    'Die Beispiele zeigen die Zielform: ein Mechanismus, eine benannte Konsequenz, ein Prüfstein, kurze Sätze. Längere Beispiele sind älter — halte dich an das Wortbudget.',
  ].join('\n\n')
}

// ── Lader ────────────────────────────────────────────────────────────────────

interface PostRow { id: string; title: string; published_at: string | null; created_at: string; content: unknown; status: string }
interface FeedbackRow { post_id: string; section_anchor: string; vote: 'agree' | 'disagree' }

/** Kleiner Prozess-Cache: ein Artikel mit 30 Abschnitten fragt dieselben Posts immer wieder an. */
const postCache = new Map<string, { row: PostRow | null; at: number }>()
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 60

async function loadPublishedPosts(ids: string[]): Promise<PostRow[]> {
  const now = Date.now()
  const missing = ids.filter((id) => { const c = postCache.get(id); return !c || now - c.at > CACHE_TTL_MS })
  if (missing.length > 0) {
    const supabase = createAdminClient()
    const { data } = await supabase.from('generated_posts').select('id, title, published_at, created_at, content, status').in('id', missing)
    const byId = new Map(((data ?? []) as PostRow[]).map((r) => [r.id, r]))
    for (const id of missing) postCache.set(id, { row: byId.get(id) ?? null, at: now })
    while (postCache.size > CACHE_MAX) postCache.delete(postCache.keys().next().value as string)
  }
  return ids.map((id) => postCache.get(id)?.row).filter((r): r is PostRow => !!r && r.status === 'published')
}

async function loadFeedback(postIds: string[]): Promise<Map<string, { agree: number; disagree: number }>> {
  const out = new Map<string, { agree: number; disagree: number }>()
  if (postIds.length === 0) return out
  const supabase = createAdminClient()
  const { data } = await supabase.from('take_feedback').select('post_id, section_anchor, vote').in('post_id', postIds)
  for (const r of (data ?? []) as FeedbackRow[]) {
    const key = `${r.post_id}|${r.section_anchor}`
    const agg = out.get(key) ?? { agree: 0, disagree: 0 }
    if (r.vote === 'agree') agg.agree++; else agg.disagree++
    out.set(key, agg)
  }
  return out
}

/**
 * Vorbild-Takes aus den thematisch nächsten veröffentlichten Posts. Non-fatal
 * gedacht: der Aufrufer fängt Fehler und schreibt dann ohne Block.
 */
export async function findExemplarTakes(pastPosts: PastPost[], query: string, limit = 3): Promise<ExemplarCandidate[]> {
  if (pastPosts.length === 0) return []
  const posts = await loadPublishedPosts(pastPosts.map((p) => p.id))
  const feedback = await loadFeedback(posts.map((p) => p.id))
  const cands: ExemplarCandidate[] = []
  for (const post of posts) {
    let doc: unknown
    try { doc = typeof post.content === 'string' ? JSON.parse(post.content) : post.content } catch { continue }
    for (const t of extractTakes(doc)) {
      const fb = feedback.get(`${post.id}|${t.anchor}`) ?? { agree: 0, disagree: 0 }
      cands.push({ postId: post.id, title: post.title, date: post.published_at ?? post.created_at, heading: t.heading, anchor: t.anchor, take: t.take, ...fb })
    }
  }
  return pickExemplars(cands, query, limit)
}
