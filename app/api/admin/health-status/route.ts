import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import type { HealthResult } from '@/lib/health/check'

/**
 * Letztes Ergebnis der Verfügbarkeitsprüfung für das Banner im Admin.
 * Geschrieben wird es vom Cron (app/api/cron/health-check), gespeichert in
 * `settings` unter health_check_last.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('settings').select('value').eq('key', 'health_check_last').maybeSingle()
    const health = (data?.value ?? null) as HealthResult | null
    if (!health) return NextResponse.json({ state: 'unbekannt' })

    // Älter als neun Stunden heisst: der Cron (alle vier Stunden) kommt nicht
    // durch. Ein veraltetes "alles gruen" waere schlimmer als keine Anzeige.
    const alterMs = Date.now() - new Date(health.checkedAt).getTime()
    const veraltet = alterMs > 9 * 60 * 60 * 1000

    return NextResponse.json({
      state: veraltet ? 'veraltet' : health.healthy ? 'ok' : 'fehler',
      checked: health.checked,
      failed: health.failed,
      checkedAt: health.checkedAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
    console.error('[HealthStatus]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
