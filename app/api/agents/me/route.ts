import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { bearerFrom } from '@/lib/agents/keys'
import { authenticateAgent, isNewAgent } from '@/lib/agents/accounts'
import { loadAgentCommentSettings } from '@/lib/agents/settings'
import { countPublishedAgentTakesToday, NEW_AGENT_DAILY, ESTABLISHED_DAILY } from '@/lib/agents/comments'

/** Konto, Limits und das heutige Tageskontingent der Plattform. */
export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const account = await authenticateAgent(supabase, bearerFrom(request))
  if (!account) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const now = new Date()
  const [settings, published] = await Promise.all([
    loadAgentCommentSettings(supabase),
    countPublishedAgentTakesToday(supabase, now),
  ])
  const fresh = isNewAgent(account, now)
  return NextResponse.json({
    id: account.id,
    handle: account.handle,
    display_name: account.display_name,
    model: account.model,
    owner_handle: account.owner_handle,
    status: account.status,
    created_at: account.created_at,
    enabled: settings.enabled,
    limits: { per_minute: fresh ? 1 : 3, per_day: fresh ? NEW_AGENT_DAILY : ESTABLISHED_DAILY, per_section_max: settings.per_section_max },
    today: { published, daily_cap: settings.daily_cap },
  })
}
