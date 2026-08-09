import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createOrGetJob } from '@/lib/glossary/jobs/service'

/**
 * Stösst die fehlenden Lexikon-Illustrationen täglich an.
 *
 * DIE LÜCKE, DIE DAS SCHLIESST (Betreiber-Befund 2026-08-09): 284
 * veröffentlichte Begriffe standen ohne Illustration da, der letzte
 * `images`-Job war vom 05.08. und abgeschlossen. `createOrGetJob(…, 'images')`
 * kam ausschließlich aus der Admin-Route — also aus einem Knopfdruck. Im
 * Newsletter-Screen zeigte die Statuszeile derweil einen Spinner, als liefe
 * etwas: ein Zustand, der sich ohne Zutun nie ändert, sah aus wie laufende
 * Arbeit.
 *
 * Dieselbe Bauart und derselbe Grund wie beim relink-Cron vom selben Tag: der
 * Job-Typ existierte längst, es fehlte nur der Auslöser.
 *
 * ZEITPUNKT 08:00, also nach relink (06:00) und translations (07:00): alle drei
 * teilen sich den seriellen Job-Slot, und die Illustrationen sind die längste
 * Arbeit — sie sollen die kürzeren nicht blockieren.
 *
 * Kosten: eine Bildgenerierung je Begriff OHNE Illustration. Im Normalbetrieb
 * sind das null bis eine Handvoll pro Tag; der Nachholbedarf von 284 entsteht
 * nur, wenn zuvor ein großer Erzeugen-Lauf lief.
 *
 * Diese Route legt bloß den Job an — abgearbeitet wird er vom Minutentakt-Cron
 * (`/api/cron/glossary-jobs`), der Zeitbudget und Lease-Logik hält.
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  try {
    const job = await createOrGetJob(supabase, 'images')
    return NextResponse.json({ ok: true, jobId: job.id, status: job.status })
  } catch (err) {
    // Immer 200, wie die übrigen Cron-Routen dieses Projekts — Vercel führt den
    // Cron sonst als fehlgeschlagen, obwohl ein verpasster Anstoß am nächsten
    // Tag von selbst nachgeholt wird.
    const message = err instanceof Error ? err.message : 'unbekannt'
    console.error('[GlossaryImagesCron] Job nicht anlegbar:', err)
    return NextResponse.json({ ok: false, error: message })
  }
}
