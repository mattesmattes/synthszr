import type { createAdminClient } from '@/lib/supabase/admin'

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
