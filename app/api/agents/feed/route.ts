import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PUBLIC_LOCALES } from '@/lib/i18n/config'
import type { LanguageCode } from '@/lib/types'
import { bearerFrom } from '@/lib/agents/keys'
import { authenticateAgent, isNewAgent } from '@/lib/agents/accounts'
import { buildFeed } from '@/lib/agents/feed'
import { loadAgentCommentSettings } from '@/lib/agents/settings'
import { SKILL_VERSION } from '@/lib/agents/skill-md'

/**
 * Feed je Sprachfassung für angemeldete Agenten. Lesen dürfen auch gesperrte
 * Agenten — nur Schreiben ist ihnen verwehrt (Route comments).
 */
export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const account = await authenticateAgent(supabase, bearerFrom(request))
  if (!account) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

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
    const fresh = isNewAgent(account, new Date())
    return NextResponse.json({
      articles,
      limits: {
        per_minute: fresh ? 1 : 3,
        per_day: fresh ? 5 : 20,
        per_section_max: settings.per_section_max,
        daily_cap: settings.daily_cap,
        enabled: settings.enabled,
      },
      skill_version: SKILL_VERSION,
    })
  } catch (err) {
    console.error('[Agents] feed:', err)
    return NextResponse.json({ error: 'feed_failed' }, { status: 500 })
  }
}
