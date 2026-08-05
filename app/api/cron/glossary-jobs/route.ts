import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { appendLog, finishJob, getNextOpenJob, releaseLease, setAttempts, stampLease } from '@/lib/glossary/jobs/service'
import { advanceJob, MAX_ATTEMPTS, stamp } from '@/lib/glossary/jobs/advance'

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
    // Befund N2 des Abschluss-Reviews: advanceJob zaehlt Ueberlast nur
    // INNERHALB der Funktion (outcome.overloaded). Eine Exception, die sie
    // VERLAESST — z. B. relinkNextBatch ohne ladbare Begriffsliste, oder
    // writeCrawlState mit fehlgeschlagenem Upsert NACH einem bereits erzeugten
    // Begriff — zaehlte bisher gar nicht mit: attempts blieb stehen, kein
    // Protokolleintrag, der naechste Cron haette den Job nach Ablauf des
    // Lease (6 Minuten) wieder aufgenommen, fuer immer, ohne dass der
    // Betreiber im Panel einen Hinweis sieht.
    const message = err instanceof Error ? err.message : 'unbekannt'
    console.error('[GlossaryJobs] Tick fehlgeschlagen:', err)

    // Sichtbar im Panel unabhaengig vom Endstatus — die alte Browser-Schleife
    // brach nach drei Runden mit sichtbarer Meldung ab, das darf hier nicht
    // schlechter werden.
    await appendLog(supabase, job, [{ at: stamp(), text: `Tick fehlgeschlagen: ${message}`, ok: false }], 0)

    const attempts = job.attempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      await finishJob(supabase, job.id, 'error', `Tick wiederholt fehlgeschlagen: ${message}`)
    } else {
      await setAttempts(supabase, job.id, attempts)
      // Lease freigeben: sonst nimmt der naechste Cron den Job erst nach
      // LEASE_STALE_MS (6 Minuten) wieder auf statt in der naechsten Minute —
      // gleiche Begruendung wie releaseLease im Ueberlast-Pfad von advanceJob.
      await releaseLease(supabase, job.id)
    }

    // ok:false statt wie vorher ok:true — sonst sieht man dem Cron-Log nicht
    // an, dass der Tick geplatzt ist. Statuscode bleibt 200, weil Vercel den
    // Cron sonst als fehlgeschlagen fuehrt.
    return NextResponse.json({ ok: false, kind: job.kind, error: message })
  }
}
