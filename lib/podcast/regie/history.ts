/**
 * Historie der Tagesregie in `settings.podcast_regie_history_<lang>` (die
 * letzten 21 Folgen, neueste zuerst). Keine eigene Tabelle: Die Regie ist
 * klein, und eine Migration müsste in diesem Projekt von Hand eingespielt
 * werden. Ein neu erzeugtes Skript zum selben Post ersetzt dessen Eintrag.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import type { RegieHistoryEntry } from '@/lib/podcast/regie/sampler'

type AdminClient = ReturnType<typeof createAdminClient>

const KEEP = 21
export const regieHistoryKey = (lang: string) => `podcast_regie_history_${lang}`

export function isHistoryEntry(x: unknown): x is RegieHistoryEntry {
  if (!x || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  return typeof e.date === 'string' && typeof e.postId === 'string' && !!e.picks && typeof e.picks === 'object'
}

export async function loadRegieHistory(supabase: AdminClient, lang: string): Promise<RegieHistoryEntry[]> {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', regieHistoryKey(lang)).maybeSingle()
    const raw = (data as { value?: unknown } | null)?.value
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed.filter(isHistoryEntry) : []
  } catch (err) {
    console.warn('[PodcastRegie] Historie nicht lesbar:', err instanceof Error ? err.message : err)
    return []
  }
}

/** Neue Historie mit dem Eintrag vorn (reine Funktion, für Tests und das Trockenlauf-Skript). */
export function withEntry(history: RegieHistoryEntry[], entry: RegieHistoryEntry): RegieHistoryEntry[] {
  return [entry, ...history.filter((h) => h.postId !== entry.postId)].slice(0, KEEP)
}

export async function saveRegieEntry(supabase: AdminClient, lang: string, entry: RegieHistoryEntry): Promise<void> {
  try {
    const history = await loadRegieHistory(supabase, lang)
    const { error } = await supabase
      .from('settings')
      .upsert({ key: regieHistoryKey(lang), value: withEntry(history, entry) }, { onConflict: 'key' })
    if (error) console.warn('[PodcastRegie] Historie nicht gespeichert:', error.message)
  } catch (err) {
    console.warn('[PodcastRegie] Historie nicht gespeichert:', err instanceof Error ? err.message : err)
  }
}
