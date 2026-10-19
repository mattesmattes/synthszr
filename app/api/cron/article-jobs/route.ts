import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'

// 800 statt 300: die Planungsphase ist ein einzelner langer Modellaufruf und
// lief in den Timeout (s. app/api/admin/article-job/route.ts).
export const maxDuration = 800

/**
 * Treibt den Tagesartikel-Job im MINUTENTAKT (vercel.json).
 *
 * WARUM EIGENER CRON: advanceArticleJob() haengt bisher am 15-Minuten-Scheduler
 * und macht EINE Phase je Tick; die Schreibphase arbeitet dabei mit einem
 * Zeitbudget von 150s (writeSectionsBatch) und wartet danach 750s auf den
 * naechsten Tick. Gemessen 2026-08-23 ueber 15 Tage: vom fertigen Digest bis
 * zum Post vergingen 70-287 Minuten, davon nur ~25 Minuten Rechenzeit — der
 * Rest war Leerlauf zwischen den Ticks. Der Artikel war dadurch nur an 4 von 15
 * Tagen vor 05:45 fertig.
 *
 * Im Minutentakt entfaellt das Warten fast vollstaendig. Das Muster ist von
 * /api/cron/glossary-jobs uebernommen, das denselben Job-Mechanismus antreibt.
 *
 * IMMER 200, auch wenn nichts zu tun ist — sonst fuehrt Vercel den Cron als
 * fehlgeschlagen. Der Scheduler ruft advanceArticleJob weiterhin ebenfalls auf;
 * doppelte Ticks sind ungefaehrlich, weil der Job-Service per Lease arbeitet.
 */
/**
 * Zeitbudget für den Start einer WEITEREN Phase im selben Aufruf (2026-10-19):
 * seit der Browser den Job nicht mehr treibt, hängt der Cron Phasen aneinander.
 * 240 s + längste Phase (Schreib-Batch 210 s, Planung mehrere Minuten) bleibt
 * unter maxDuration 800.
 */
const LOOP_BUDGET_MS = 240_000

/** Ergebnisse, nach denen es im selben Aufruf nichts mehr zu tun gibt. */
const STOP_RESULTS = new Set(['no_job', 'claimed_elsewhere', 'tick_error', 'lexicon_done', 'done', 'error', 'unknown_phase'])

export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const { advanceArticleJob } = await import('@/lib/article-jobs/service')
    const startedAt = Date.now()
    const results: string[] = []
    // Phasen aneinanderhängen, solange Budget bleibt — jede Phase gibt den Lease
    // frei, der nächste Durchlauf claimt denselben Job erneut.
    do {
      const result = await advanceArticleJob()
      results.push(result)
      if (STOP_RESULTS.has(result) || result.startsWith('error')) break
    } while (Date.now() - startedAt < LOOP_BUDGET_MS)
    const result = results[results.length - 1]
    if (result !== 'no_job') console.log('[cron/article-jobs]', results.join(' → '))
    return NextResponse.json({ ok: true, result, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unbekannt'
    console.error('[cron/article-jobs]', error)
    return NextResponse.json({ ok: false, error: message })
  }
}
