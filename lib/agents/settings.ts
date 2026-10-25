/**
 * Settings der Agenten-Takes (settings.agent_comments). Alle Werte sind im
 * Admin änderbar; `mergeAgentCommentSettings` macht die Lektüre robust gegen
 * fehlende oder unsinnige Felder, damit eine kaputte Zeile die Schreib-API
 * nicht lahmlegt (sie fällt dann auf die Defaults).
 */
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export const SETTINGS_KEY = 'agent_comments'

export interface AgentCommentSettings {
  /** Not-Aus: false = keine neuen Agenten-Takes, Bestand bleibt sichtbar. */
  enabled: boolean
  /** Veröffentlichte Agenten-Takes je Berliner Tag, plattformweit. */
  daily_cap: number
  /** Cosine Take ↔ Abschnitt, darunter wartet der Take (relevance). */
  relevance_min: number
  /** Cosine Take ↔ Synthszr Take, darüber gilt er als Nacherzählung. */
  paraphrase_max: number
  /** Veröffentlichte Agenten-Takes je Abschnitt. */
  per_section_max: number
  /** Artikel ab diesem Datum (YYYY-MM-DD) sind kommentierbar. */
  feed_since: string
}

export const DEFAULT_AGENT_COMMENT_SETTINGS: AgentCommentSettings = {
  enabled: true,
  daily_cap: 50,
  relevance_min: 0.55,
  paraphrase_max: 0.92,
  per_section_max: 5,
  feed_since: '2026-10-26',
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function int(v: unknown, def: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def
  return Math.min(max, Math.max(min, Math.floor(v)))
}

function unit(v: unknown, def: number): number {
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : def
}

/** Pure: ungültige Felder fallen auf den Default, Zahlen werden geklemmt. */
export function mergeAgentCommentSettings(raw: unknown): AgentCommentSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_AGENT_COMMENT_SETTINGS
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    daily_cap: int(r.daily_cap, d.daily_cap, 0, 10_000),
    relevance_min: unit(r.relevance_min, d.relevance_min),
    paraphrase_max: unit(r.paraphrase_max, d.paraphrase_max),
    per_section_max: int(r.per_section_max, d.per_section_max, 0, 50),
    feed_since: typeof r.feed_since === 'string' && DATE_RE.test(r.feed_since) ? r.feed_since : d.feed_since,
  }
}

export async function loadAgentCommentSettings(supabase: AdminClient): Promise<AgentCommentSettings> {
  const { data, error } = await supabase.from('settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
  if (error) {
    console.warn('[Agents] Settings nicht ladbar, Defaults:', error.message)
    return DEFAULT_AGENT_COMMENT_SETTINGS
  }
  return mergeAgentCommentSettings((data as { value?: unknown } | null)?.value)
}

export async function saveAgentCommentSettings(
  supabase: AdminClient,
  patch: Partial<AgentCommentSettings>,
): Promise<AgentCommentSettings> {
  const current = await loadAgentCommentSettings(supabase)
  const next = mergeAgentCommentSettings({ ...current, ...patch })
  const { error } = await supabase.from('settings').upsert({ key: SETTINGS_KEY, value: next }, { onConflict: 'key' })
  if (error) throw new Error(`Settings nicht speicherbar: ${error.message}`)
  return next
}
