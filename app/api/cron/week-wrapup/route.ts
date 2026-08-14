import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildWeekWrapup } from '@/lib/wrapup/build'

export const maxDuration = 300

/**
 * GET /api/cron/week-wrapup — Wochenrückblick der abgeschlossenen Woche
 * (vercel.json: sonntags 06:00 UTC).
 *
 * Ruft dieselbe Funktion wie das Admin-Panel. Der Rückblick entsteht als
 * ENTWURF — wie der Tagespost auch; über die Freigabe entscheidet der Betreiber.
 *
 * MIT skipIfExists: Gibt es den Rückblick dieser Woche schon, passiert nichts.
 * Ohne die Prüfung legte ein zweiter Lauf — nach Zeitüberschreitung oder von
 * Hand ausgelöst — einen zweiten Entwurf an, weil buildUniqueSlug bei Kollision
 * eine Zahl anhängt statt abzubrechen.
 *
 * GIBT IMMER 200 ZURÜCK (außer bei fehlender Auth): Eine Woche ohne
 * veröffentlichte Artikel ist ein Betriebsfall, kein Vercel-Fehler.
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const r = await buildWeekWrapup(createAdminClient(), { skipIfExists: true })
    console.log('[cron/week-wrapup]', JSON.stringify(r))
    return NextResponse.json({ success: true, ...r })
  } catch (e) {
    console.error('[cron/week-wrapup]', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    )
  }
}
