import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { runTechmemeJob } from '@/lib/techmeme/job'

export const maxDuration = 300

/**
 * GET /api/cron/techmeme — Techmeme als Entdeckungsquelle für die News-Queue.
 *
 * Liest die Startseite, behält die KI-relevanten Meldungen und schreibt deren
 * Quellartikel in die Queue (vercel.json: alle vier Stunden, versetzt zu den
 * übrigen Cron-Läufen).
 *
 * GIBT IMMER 200 ZURÜCK (außer bei fehlender Auth). Ein nicht erreichbarer
 * fremder Server oder eine geänderte Seitenstruktur bei Techmeme ist ein
 * Betriebsfall, kein Vercel-Fehler — sonst schlägt der Alarm für etwas an, das
 * niemand hier beheben kann, und der nächste Lauf holt es ohnehin nach.
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await runTechmemeJob(createAdminClient())
    console.log('[cron/techmeme]', JSON.stringify(result))
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    console.error('[cron/techmeme]', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    )
  }
}
