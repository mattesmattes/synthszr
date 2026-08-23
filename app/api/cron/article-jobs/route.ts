import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'

export const maxDuration = 300

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
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const { advanceArticleJob } = await import('@/lib/article-jobs/service')
    const result = await advanceArticleJob()
    if (result !== 'no_job') console.log('[cron/article-jobs]', result)
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unbekannt'
    console.error('[cron/article-jobs]', error)
    return NextResponse.json({ ok: false, error: message })
  }
}
