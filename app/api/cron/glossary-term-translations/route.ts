import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createOrGetJob } from '@/lib/glossary/jobs/service'

/**
 * Zieht fehlende ENGLISCHE Begriffserklärungen täglich nach.
 *
 * Nicht zu verwechseln mit `/api/cron/glossary-translations`: der verlinkt
 * übersetzte ARTIKEL nach, dieser hier erzeugt fehlende BEGRIFFS-Übersetzungen.
 *
 * Warum es diesen Lauf braucht, obwohl beide Erzeugungswege bereits übersetzen
 * (`crawl.ts` nach dem Generieren, `confirm.ts` bei der Freigabe): Beide tun es
 * best-effort im selben Request. Läuft der Request ins Zeitlimit, ist das Modell
 * überlastet oder scheitert der Aufruf sonstwie, ist der Begriff bereits
 * veröffentlicht — die Übersetzung fehlt aber, und NICHTS holte sie je nach. Ein
 * so entstandener Begriff blieb dauerhaft deutsch, auf /en/glossary/* sichtbar.
 *
 * Betreiber-Befund 2026-08-11: 25 von 2506 veröffentlichten Begriffen ohne
 * englische Fassung, alle vom selben Tag — genau dieses Muster.
 *
 * Der Lauf ist selbstbegrenzend: `translateMissingTerms` bildet die Differenz
 * aus veröffentlichten Begriffen und vorhandenen Übersetzungen und stoppt bei
 * null. Ist nichts offen, endet der Job sofort ohne einen einzigen Modellaufruf.
 *
 * Zeitpunkt 09:00: nach den übrigen Lexikon-Läufen (Review 05:00, Relink 06:00,
 * Artikel-Übersetzungen 07:00, Illustrationen 08:00). Neue Begriffe des Tages
 * sind bis dahin erzeugt, ihre fehlenden Übersetzungen also vollständig sichtbar.
 *
 * Diese Route legt bloß den Job an — abgearbeitet wird er vom Minutentakt-Cron
 * (`/api/cron/glossary-jobs`), der Zeitbudget und Lease-Logik hält. Ein Begriff
 * je Arbeitseinheit, damit das Zeitlimit nach jedem Modellaufruf greifen kann.
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  try {
    const job = await createOrGetJob(supabase, 'term-translations')
    return NextResponse.json({ ok: true, jobId: job.id, status: job.status })
  } catch (err) {
    // Immer 200, wie die übrigen Cron-Routen dieses Projekts — Vercel führt den
    // Cron sonst als fehlgeschlagen, obwohl ein verpasster Anstoß am nächsten
    // Tag von selbst nachgeholt wird.
    const message = err instanceof Error ? err.message : 'unbekannt'
    console.error('[GlossaryTermTranslationsCron] Job nicht anlegbar:', err)
    return NextResponse.json({ ok: false, error: message })
  }
}
