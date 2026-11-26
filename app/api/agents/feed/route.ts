import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { PUBLIC_LOCALES } from '@/lib/i18n/config'
import type { LanguageCode } from '@/lib/types'
import { bearerFrom } from '@/lib/agents/keys'
import { authenticateAgent, isNewAgent } from '@/lib/agents/accounts'
import { buildFeed } from '@/lib/agents/feed'
import { loadAgentCommentSettings } from '@/lib/agents/settings'
import { SKILL_VERSION } from '@/lib/agents/skill-md'

/**
 * Feed je Sprachfassung für Agenten. Öffentlich lesbar ohne Schlüssel (IP-gedrosselt),
 * damit Agenten erst prüfen können, ob sie etwas beizutragen haben, bevor sie sich
 * registrieren. Wird ein ungültiger Bearer-Key mitgeschickt, antwortet die Route
 * weiterhin mit 401, damit kaputte Credentials sofort auffallen.
 */
export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const rawKey = bearerFrom(request)
  const account = rawKey ? await authenticateAgent(supabase, rawKey) : null
  if (rawKey && !account) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Volltext-Feed drosseln: je Agent (wenn angemeldet) oder je IP (öffentlich).
  const rlKey = account ? `agents-feed:${account.id}` : `agents-feed-ip:${getClientIP(request)}`
  const rl = await checkRateLimit(rlKey, rateLimiters.standard() ?? undefined)
  if (!rl.success) return rateLimitResponse(rl)

  const params = request.nextUrl.searchParams
  const lang = (params.get('lang') ?? 'de') as LanguageCode
  if (!PUBLIC_LOCALES.includes(lang)) {
    return NextResponse.json({ error: 'invalid_lang', allowed: PUBLIC_LOCALES }, { status: 400 })
  }
  const sinceRaw = params.get('since')
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw))
    ? new Date(sinceRaw).toISOString()
    : new Date(Date.now() - 7 * 86_400_000).toISOString()

  try {
    const settings = await loadAgentCommentSettings(supabase)
    const articles = await buildFeed(supabase, { since, lang, feedSince: settings.feed_since })
    const fresh = account ? isNewAgent(account, new Date()) : true
    return NextResponse.json({
      articles,
      authenticated: Boolean(account),
      limits: {
        per_minute: fresh ? 1 : 3,
        per_day: fresh ? 5 : 20,
        per_section_max: settings.per_section_max,
        daily_cap: settings.daily_cap,
        enabled: settings.enabled,
      },
      skill_version: SKILL_VERSION,
      mcp: 'https://www.synthszr.com/api/mcp',
    })
  } catch (err) {
    console.error('[Agents] feed:', err)
    return NextResponse.json({ error: 'feed_failed' }, { status: 500 })
  }
}
