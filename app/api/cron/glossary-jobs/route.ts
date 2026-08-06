import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { appendLog, claimJob, finishJob, getNextOpenJob, releaseLease } from '@/lib/glossary/jobs/service'
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

  // Aufgeben, BEVOR gearbeitet wird: hat der Job MAX_ATTEMPTS Ticks hinter
  // sich, ohne dass einer davon Fortschritt gemeldet hat, ist er hin. Dieser
  // Check ist der einzige Ausweg aus einem Tick, der ins Function-Timeout
  // laeuft — ein hart beendeter Prozess kann selbst nichts mehr schreiben
  // (Befund 2026-08-06, s. claimJob).
  if (job.attempts >= MAX_ATTEMPTS) {
    await finishJob(
      supabase, job.id, 'error',
      `Nach ${MAX_ATTEMPTS} Durchgaengen ohne Fortschritt aufgegeben. Haeufigste Ursache: eine `
      + 'Arbeitseinheit laeuft ins Zeitlimit der Function (300s) und wird hart beendet. '
      + 'Server-Log des letzten Ticks pruefen.',
    )
    return NextResponse.json({ ok: false, kind: job.kind, error: 'max attempts' })
  }

  // Versuch zaehlen und Lease stempeln in EINEM Update, vor der Arbeit.
  const attempt = job.attempts + 1
  await claimJob(supabase, job.id, attempt)
  job.attempts = attempt

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

    // Nicht mehr hier zaehlen: claimJob hat den Versuch schon beim Aufnehmen
    // persistiert, und der Check oben eskaliert beim naechsten Tick. Ein
    // zweites Hochzaehlen an dieser Stelle wuerde eine Exception doppelt
    // gewichten gegenueber einem Timeout — der Grenzfall, dessen ungleiche
    // Behandlung den Hänger vom 2026-08-06 ueberhaupt erst unsichtbar machte.
    //
    // Lease freigeben: sonst nimmt der naechste Cron den Job erst nach
    // LEASE_STALE_MS (6 Minuten) wieder auf statt in der naechsten Minute —
    // gleiche Begruendung wie releaseLease im Ueberlast-Pfad von advanceJob.
    await releaseLease(supabase, job.id)

    // ok:false statt wie vorher ok:true — sonst sieht man dem Cron-Log nicht
    // an, dass der Tick geplatzt ist. Statuscode bleibt 200, weil Vercel den
    // Cron sonst als fehlgeschlagen fuehrt.
    return NextResponse.json({ ok: false, kind: job.kind, error: message })
  }
}
