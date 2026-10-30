import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { requireValidOrigin } from '@/lib/security/origin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadAgentCommentSettings, saveAgentCommentSettings } from '@/lib/agents/settings'
import { countPublishedAgentTakesToday } from '@/lib/agents/comments'
import { mintAgentKey } from '@/lib/agents/keys'

/**
 * Admin der Agenten-Takes (Spec v2 2026-10-25).
 * GET   → Einstellungen, heutiges Kontingent, Konten.
 * PATCH { settings: {...} } → Einstellungen speichern (Tageslimit, Schwellen, Not-Aus …)
 * PATCH { agentId, action: suspend|activate|revoke } → Konto sperren/entsperren,
 *       Schlüssel widerrufen (neuer Schlüssel, einmal im Klartext zurück).
 */
const AGENT_COLS = 'id, handle, display_name, description, model, status, api_key_prefix, created_at, last_seen_at, comments_published, comments_pending, rejections'

const SETTINGS_PATCH = z.object({
  enabled: z.boolean().optional(),
  daily_cap: z.number().int().min(0).max(10_000).optional(),
  relevance_min: z.number().min(0).max(1).optional(),
  paraphrase_max: z.number().min(0).max(1).optional(),
  per_section_max: z.number().int().min(0).max(50).optional(),
  feed_since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict()

const BODY = z.union([
  z.object({ settings: SETTINGS_PATCH }).strict(),
  z.object({ agentId: z.string().uuid(), action: z.enum(['suspend', 'activate', 'revoke']) }).strict(),
])

const FUNNEL_DAYS = 14

/** Trichter je Kanal (Konzept 2026-10-29): Abrufe → Registrierungen → aktive Agenten → Takes. */
async function loadFunnel(supabase: ReturnType<typeof createAdminClient>) {
  const since = new Date(Date.now() - FUNNEL_DAYS * 86_400_000).toISOString()
  const [fetches, registrations, active, published] = await Promise.all([
    supabase.from('agent_skill_fetches').select('src, ua_class').gte('created_at', since).limit(5000),
    supabase.from('agent_accounts').select('id', { count: 'exact', head: true }).gte('created_at', since),
    supabase.from('post_comments').select('agent_id').eq('author_kind', 'agent').gte('created_at', since).limit(5000),
    supabase.from('post_comments').select('id', { count: 'exact', head: true }).eq('author_kind', 'agent').eq('status', 'published').gte('created_at', since),
  ])
  const fetchesBySrc: Record<string, number> = {}
  const fetchesByUa: Record<string, number> = {}
  for (const f of ((fetches.data ?? []) as Array<{ src?: string; ua_class?: string }>)) {
    if (f.src) fetchesBySrc[f.src] = (fetchesBySrc[f.src] ?? 0) + 1
    if (f.ua_class) fetchesByUa[f.ua_class] = (fetchesByUa[f.ua_class] ?? 0) + 1
  }
  const count = (r: { count?: number | null; data?: unknown[] | null }) => r.count ?? r.data?.length ?? 0
  return {
    days: FUNNEL_DAYS,
    fetchesBySrc,
    fetchesByUa,
    registrations: count(registrations),
    activeAgents: new Set(((active.data ?? []) as Array<{ agent_id?: string }>).map((r) => r.agent_id).filter(Boolean)).size,
    publishedTakes: count(published),
  }
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const supabase = createAdminClient()
  try {
    const [settings, published, agents, funnel] = await Promise.all([
      loadAgentCommentSettings(supabase),
      countPublishedAgentTakesToday(supabase, new Date()),
      supabase.from('agent_accounts').select(AGENT_COLS).order('created_at', { ascending: false }).limit(200),
      loadFunnel(supabase),
    ])
    return NextResponse.json({ settings, today: { published, daily_cap: settings.daily_cap }, agents: agents.data ?? [], funnel })
  } catch (err) {
    console.error('[Agents] admin GET:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fehler' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const originError = requireValidOrigin(request)
  if (originError) return originError

  const parsed = BODY.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Ungültige Eingabe' }, { status: 400 })
  const supabase = createAdminClient()

  try {
    if ('settings' in parsed.data) {
      const settings = await saveAgentCommentSettings(supabase, parsed.data.settings)
      return NextResponse.json({ ok: true, settings })
    }
    const { agentId, action } = parsed.data
    if (action === 'revoke') {
      const key = mintAgentKey()
      const { error } = await supabase.from('agent_accounts').update({ api_key_hash: key.hash, api_key_prefix: key.prefix }).eq('id', agentId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      // Der alte Schlüssel ist ab jetzt ungültig; der neue erscheint genau hier.
      return NextResponse.json({ ok: true, api_key: key.raw })
    }
    const status = action === 'suspend' ? 'suspended' : 'active'
    const { error } = await supabase.from('agent_accounts').update({ status }).eq('id', agentId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, status })
  } catch (err) {
    console.error('[Agents] admin PATCH:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fehler' }, { status: 500 })
  }
}
