import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createOrGetJob } from '@/lib/glossary/jobs/service'

/**
 * Stösst die Nachverlinkung DEUTSCHER Artikel täglich an.
 *
 * DIE LÜCKE, DIE DAS SCHLIESST (Betreiber-Frage 2026-08-07): beim Erzeugen eines
 * Begriffs lief bereits alles von selbst — veröffentlichen, Illustration,
 * Produkt-Zuordnung und die englische Fassung (`translatePublishedTerms` in
 * crawl.ts) —, und übersetzte Artikel holte der 07:00-Cron nach. Nur der
 * `relink`-Job blieb übrig: `createOrGetJob(…, 'relink')` kam ausschließlich aus
 * der Admin-Route, also aus einem Knopfdruck. Ein neuer Begriff war damit zwar
 * sofort als Lexikonseite da, in den bestehenden Artikeln aber erst verlinkt,
 * wenn jemand daran dachte. Der Job-Typ existierte längst — es fehlte nur der
 * Auslöser.
 *
 * ZEITPUNKT 06:00, eine Stunde VOR glossary-translations: `relink` fasst
 * ausschließlich `generated_posts` an, und die Übersetzungs-Nachverlinkung nimmt
 * ihre Slugs aus dem deutschen Quelltext. In dieser Reihenfolge findet sie am
 * selben Tag etwas vor, statt dem Original einen Tag hinterherzulaufen.
 *
 * OHNE `from`: die Admin-Route kennt ein Startdatum für einen gezielten
 * Teillauf. Hier wäre es falsch — eine Datumsgrenze ließe ältere Artikel
 * dauerhaft ohne die neuen Begriffe, und genau das soll dieser Cron verhindern.
 * Der Lauf setzt seinen Cursor am Ende zurück, geht also wieder durch den
 * ganzen Bestand.
 *
 * Kein Kostenrisiko: Nachverlinken setzt Marks und macht keine Modell-Aufrufe.
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
    const job = await createOrGetJob(supabase, 'relink')
    return NextResponse.json({ ok: true, jobId: job.id, status: job.status })
  } catch (err) {
    // Immer 200, wie die übrigen Cron-Routen dieses Projekts — Vercel führt den
    // Cron sonst als fehlgeschlagen, obwohl ein verpasster Anstoß am nächsten
    // Tag von selbst nachgeholt wird.
    const message = err instanceof Error ? err.message : 'unbekannt'
    console.error('[GlossaryRelinkCron] Job nicht anlegbar:', err)
    return NextResponse.json({ ok: false, error: message })
  }
}
