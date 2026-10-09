import type { createAdminClient } from '@/lib/supabase/admin'
import { isJunkTitle } from '@/lib/news-queue/service'
import { parseTipTapContent } from '@/lib/utils/safe-json'
type AdminClient = ReturnType<typeof createAdminClient>

const PAGE = 200 // generated_posts-Pagination
// WARUM 200 statt 500: .in()-Listen ab ~400 UUIDs (GET-Query-String) lösen
// gegen die Produktions-Supabase-Instanz einen HeadersOverflowError (undici)
// aus — empirisch geprüft. lib/news-taste/features.ts nutzt aus demselben
// Grund bereits IN_CHUNK = 200.
const IN_CHUNK = 200

/**
 * queueItemId-Attribute aus TipTap-JSON veröffentlichter Posts ziehen — die
 * Ground Truth des News-Taste-Modells (gleiche Quelle wie
 * scripts/backtest-scoring.ts: Heading-Nodes tragen die Herkunfts-IDs).
 * Geteilt zwischen Backfill (Task 5), Baseline (Task 6) und Export (Task 7)
 * — genau eine Implementierung, kein Copy-Paste.
 */
export function extractQueueItemIds(content: unknown): string[] {
  const ids: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; attrs?: { queueItemId?: string }; content?: unknown[] }
    if (n.type === 'heading' && n.attrs?.queueItemId) ids.push(n.attrs.queueItemId)
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  const root = typeof content === 'string' ? safeParse(content) : content
  walk(root)
  return [...new Set(ids)]
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

/**
 * Alle queueItemIds aus veröffentlichten Posts — paginiert über
 * generated_posts, da das zehntausende Zeilen umfassen kann.
 */
export async function collectLabeledIds(supabase: AdminClient): Promise<string[]> {
  const ids = new Set<string>()
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.from('generated_posts')
      .select('content').eq('status', 'published')
      .order('created_at', { ascending: true }).range(offset, offset + PAGE - 1)
    if (error) throw new Error(`generated_posts: ${error.message}`)
    if (!data || data.length === 0) break
    for (const p of data) for (const id of extractQueueItemIds(p.content)) ids.add(id)
    if (data.length < PAGE) break
  }
  return [...ids]
}

/**
 * Sortierte, eindeutige UTC-Tage (YYYY-MM-DD nach queued_at), an denen
 * mindestens ein gelabeltes Item eingereiht wurde — genau diese Tage
 * brauchen Kandidaten-Feature-Vektoren fürs Training.
 */
export async function collectGroundTruthDays(supabase: AdminClient, labeledIds: string[]): Promise<string[]> {
  const days = new Set<string>()
  for (let i = 0; i < labeledIds.length; i += IN_CHUNK) {
    const { data, error } = await supabase.from('news_queue')
      .select('id, queued_at').in('id', labeledIds.slice(i, i + IN_CHUNK))
    if (error) throw new Error(`news_queue: ${error.message}`)
    for (const r of data ?? []) if (r.queued_at) days.add((r.queued_at as string).slice(0, 10))
  }
  return [...days].sort()
}

/**
 * UTC-Tagesfenster [from, to) für einen Tag (YYYY-MM-DD). `to` ist der
 * NÄCHSTE UTC-Tag um 00:00:00.000Z, nicht `${day}T23:59:59.999Z`:
 * timestamptz hat Mikrosekunden-Auflösung, ".999Z" verliert Zeilen ab
 * xx:xx:59.9995 — sowohl aus diesem als auch (durch die Lücke) potenziell
 * aus dem nächsten Tag. Date.UTC() normalisiert Tagesüberlauf automatisch,
 * darum korrekt über Monats-/Jahresgrenzen hinweg (Backfill und ein
 * späterer Export nutzen exakt dasselbe Fenster).
 */
export function dayWindow(day: string): { from: string; to: string } {
  const [y, m, d] = day.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, d))
  const to = new Date(Date.UTC(y, m - 1, d + 1))
  return { from: from.toISOString(), to: to.toISOString() }
}

export const MIN_CONTENT_LENGTH = 500 // wie ranking-service.ts (Stufe 1 des Rankings)
export const DAY_LIMIT = 2000 // Kandidaten-Obergrenze je Tag

export interface DayCandidateRow {
  id: string
  title: string
  content_length: number | null
}

/**
 * Lädt und filtert die news_queue-Kandidaten eines Tages (Junk-Titel raus,
 * >= 500 Zeichen) — geteilt zwischen Backfill (Task 5) und Export (Task 7),
 * damit beide exakt dieselbe Kandidatenmenge sehen (Trainings-Items müssen
 * die Items sein, die auch Feature-Vektoren bekommen haben). `columns`
 * wählt die Supabase-Select-Spalten je Aufrufer — der Backfill braucht z.B.
 * excerpt für den State-Text, der Export nicht: weniger Spalten heißt
 * weniger Egress (siehe Memory: Supabase-Egress-Diagnose).
 *
 * Wirft NICHT bei Query-Fehler (wie zuvor im Backfill inline) — der
 * Aufrufer entscheidet, ob der Tag übersprungen wird, statt der ganze Lauf.
 */
export async function loadDayCandidates<T extends DayCandidateRow>(
  supabase: AdminClient,
  day: string,
  columns: string,
): Promise<{ rows: T[]; truncated: boolean; error: string | null }> {
  const { from, to } = dayWindow(day)
  const { data, error } = await supabase.from('news_queue')
    .select(columns)
    .gte('queued_at', from).lt('queued_at', to)
    .order('id', { ascending: true }) // deterministisch, damit .limit() reproduzierbar abschneidet
    .limit(DAY_LIMIT)
  if (error) return { rows: [], truncated: false, error: error.message }
  const raw = (data ?? []) as unknown as T[]
  const rows = raw.filter((r) => !isJunkTitle(r.title) && (r.content_length ?? 0) >= MIN_CONTENT_LENGTH)
  return { rows, truncated: raw.length === DAY_LIMIT, error: null }
}

/**
 * Eine veröffentlichte Einheit = ein Top-Level-H2 des Posts (Spec
 * „Präzedenzfälle", Vertrag 2.6). `position` ist der 0-basierte Index unter
 * den H2-Einheiten des Posts (wie headingIndex in applyBundleMarkers),
 * `memberIds` die Queue-Items, aus denen der Abschnitt geschrieben wurde.
 */
export interface PublishedUnit {
  position: number
  heading: string
  bundleType: string | null
  memberIds: string[]
  firstParagraph: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type TiptapNodeLike = {
  type?: unknown
  attrs?: Record<string, unknown> | null
  content?: unknown
  text?: unknown
}

/** Alle Textknoten eines Teilbaums konkateniert (Marks sind egal, hardBreak hat keinen Text). */
function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as TiptapNodeLike
  if (typeof n.text === 'string') return n.text
  if (Array.isArray(n.content)) return n.content.map(textOf).join('')
  return ''
}

/**
 * Member-IDs eines Headings: `queueItemIds` (kommagetrennt, Vertrag 2.5)
 * hat Vorrang, sonst `queueItemId` (Bestand vor Phase 0). Nur echte UUIDs —
 * BEFUND 2026-10-06 (assisted_ranking.sql:63): queueItemId steht im Bestand
 * teils als String 'null' in den Attrs; extractQueueItemIds lässt das
 * durch (truthy), hier darf es keine Member-ID werden. Nicht-String-Werte
 * (Array, Zahl) ergeben [].
 */
function memberIdsOf(attrs: Record<string, unknown> | null | undefined): string[] {
  if (!attrs) return []
  const fromList = typeof attrs.queueItemIds === 'string'
    ? attrs.queueItemIds.split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s))
    : []
  if (fromList.length > 0) return [...new Set(fromList)]
  const single = attrs.queueItemId
  return typeof single === 'string' && UUID_RE.test(single) ? [single] : []
}

/**
 * Top-Level-H2-Einheiten eines veröffentlichten Posts.
 *
 * WARUM nicht extractQueueItemIds erweitern: das läuft rekursiv über alle
 * Tiefen und liefert nur IDs — Phase 0 braucht je Abschnitt Heading-Text
 * (Embedding), Rolle (`bundleType`) und Position, und zwar NUR für
 * Top-Level-H2, weil applyBundleMarkers bundleType ausschließlich auf
 * Top-Level-Headings schreibt (markdown-to-tiptap.ts:55-67) und H1/H3 keine
 * Abschnitte sind. firstParagraph = Text des ersten paragraph-Knotens nach dem
 * Heading (Suche endet am nächsten Heading), '' wenn keiner — zusammen mit
 * dem Heading der Embedding-Text der Einheit.
 *
 * Kaputtes JSON, null, {} oder eine Nicht-Array-Wurzel ergeben [] (Vertrag 0:
 * immer über parseTipTapContent, kaputte Zeilen überspringen).
 */
export function extractPublishedUnits(content: unknown): PublishedUnit[] {
  const root = parseTipTapContent(content as string | Record<string, unknown>)
  const rootContent = (root as { content?: unknown }).content
  const nodes: unknown[] = Array.isArray(root) ? root : Array.isArray(rootContent) ? rootContent : []
  const units: PublishedUnit[] = []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as TiptapNodeLike | null
    if (!n || typeof n !== 'object' || n.type !== 'heading') continue
    const attrs = n.attrs ?? undefined
    if (Number(attrs?.level) !== 2) continue

    let firstParagraph = ''
    for (let j = i + 1; j < nodes.length; j++) {
      const m = nodes[j] as TiptapNodeLike | null
      if (!m || typeof m !== 'object') continue
      if (m.type === 'heading') break
      if (m.type === 'paragraph') {
        firstParagraph = textOf(m).trim()
        break
      }
    }

    const bundleType = typeof attrs?.bundleType === 'string' && attrs.bundleType.length > 0 ? attrs.bundleType : null
    units.push({
      position: units.length,
      heading: textOf(n).trim(),
      bundleType,
      memberIds: memberIdsOf(attrs),
      firstParagraph,
    })
  }
  return units
}
