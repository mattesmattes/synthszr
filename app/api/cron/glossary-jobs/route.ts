import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNextOpenJob, stampLease } from '@/lib/glossary/jobs/service'
import { advanceJob } from '@/lib/glossary/jobs/advance'

export const maxDuration = 300

/**
 * Treibt die Lexikonlaeufe. Vorher trieb sie der Browser in for(;;)-Schleifen,
 * was den Fortschritt an einen aktiven Tab band: bei einem Lauf am 2026-08-05
 * stand der Lauf 80 Minuten, obwohl der Server nach 12s fertig war.
 *
 * Immer 200, auch wenn nichts zu tun ist — wie die uebrigen Cron-Routen dieses
 * Projekts, damit Vercel den Job nicht als fehlgeschlagen fuehrt.
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const job = await getNextOpenJob(supabase)
  if (!job) return NextResponse.json({ ok: true, idle: true })

  await stampLease(supabase, job.id)

  try {
    const result = await advanceJob(supabase, job)
    return NextResponse.json({ ok: true, kind: job.kind, ...result })
  } catch (err) {
    // Nicht als Job-Fehler abhaken: ein einzelner geplatzter Tick ist normal
    // (Netz, Timeout). Das Lease laeuft ab, der naechste Cron nimmt den Job
    // wieder auf — jede Einheit ist atomar.
    console.error('[GlossaryJobs] Tick fehlgeschlagen:', err)
    return NextResponse.json({ ok: true, error: err instanceof Error ? err.message : 'unbekannt' })
  }
}
