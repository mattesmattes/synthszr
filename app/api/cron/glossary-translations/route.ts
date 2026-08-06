import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createOrGetJob } from '@/lib/glossary/jobs/service'

/**
 * Stösst die Nachverlinkung übersetzter Artikel täglich an.
 *
 * Warum das nötig ist: `reinjectGlossaryMarksForTranslation` nimmt die Slugs aus
 * dem QUELLTEXT, und eine Übersetzung entsteht regelmäßig BEVOR der deutsche
 * Artikel verlinkt ist (die Begriffe werden erst freigegeben, wenn jemand den
 * Artikel redigiert). Zum Übersetzungszeitpunkt gibt es dann nichts zu
 * injizieren, und nachgeholt wird es von selbst nie — `backfillGlossaryLinks`
 * fasst ausschließlich `generated_posts` an. Ohne diesen Cron sehen alle
 * nicht-deutschen Leser dauerhaft keine Lexikon-Links (Befund 2026-08-06: 0 von
 * 743 Übersetzungszeilen hatten eine Mark).
 *
 * Zeitpunkt 07:00: der Tagesartikel entsteht um 05:30, seine Übersetzungen
 * laufen gegen 06:30 durch (gemessen an `translated_at`). Der bestehende
 * Lexikon-Cron um 05:00 wäre zu früh und würde die Übersetzungen des Tages
 * systematisch erst am Folgetag einholen.
 *
 * Nur einmal täglich: der Lauf setzt seinen Cursor am Ende zurück, ein erneuter
 * Anstoß geht deshalb wieder durch den ganzen Bestand.
 *
 * Diese Route legt bloß den Job an — abgearbeitet wird er vom Minutentakt-Cron
 * (`/api/cron/glossary-jobs`), der auch das Zeitbudget und die Lease-Logik hält.
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  try {
    const job = await createOrGetJob(supabase, 'translations')
    return NextResponse.json({ ok: true, jobId: job.id, status: job.status })
  } catch (err) {
    // Immer 200, wie die übrigen Cron-Routen dieses Projekts — Vercel führt den
    // Cron sonst als fehlgeschlagen, obwohl ein verpasster Anstoß am nächsten
    // Tag von selbst nachgeholt wird.
    const message = err instanceof Error ? err.message : 'unbekannt'
    console.error('[GlossaryTranslationsCron] Job nicht anlegbar:', err)
    return NextResponse.json({ ok: false, error: message })
  }
}
