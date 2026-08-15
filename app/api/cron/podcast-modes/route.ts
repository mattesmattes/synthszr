import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { refreshModes } from '@/lib/podcast/mode-generator'

export const maxDuration = 300

/**
 * GET /api/cron/podcast-modes — neue Eröffnungen und Verabschiedungen für die
 * kommende Woche (vercel.json: montags 03:00 UTC, vor dem ersten Podcast).
 *
 * Für JEDE Sprache getrennt: Die Anweisungen stehen in der Sprache, in der das
 * Skript geschrieben wird — ein deutscher Modus in einer englischen Sendung
 * würde das Modell in die falsche Sprache ziehen.
 *
 * GIBT IMMER 200 ZURÜCK (außer bei fehlender Auth). Misslingt ein Lauf, bleibt
 * der Satz der Vorwoche stehen — eine Woche mit den vorigen Modi ist besser als
 * der Rückfall auf die eingebauten.
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const now = new Date()
  const results: Record<string, unknown> = {}

  for (const lang of ['de', 'en']) {
    results[lang] = await refreshModes(supabase, lang, now)
  }
  console.log('[cron/podcast-modes]', JSON.stringify(results))
  return NextResponse.json({ success: true, ...results })
}
