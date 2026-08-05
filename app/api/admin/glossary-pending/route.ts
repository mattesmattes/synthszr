/**
 * Erzeugt vorgemerkte Lexikonbegriffe eines Artikels — EINZELN. Getrieben wurde
 * dieser Lauf bis 2026-08-05 vom Browser in einer for(;;)-Schleife
 * (glossary-approval-panel.tsx); das hing den Fortschritt an einen aktiven
 * Tab und ließ Begriffe bezahlt-aber-unveröffentlicht liegen, sobald der Tab
 * wechselte oder gedrosselt wurde (49 Fälle in Prod). Der Antrieb läuft jetzt
 * über glossary_jobs (Job-Art 'pending', s. lib/glossary/jobs), die Fachlogik
 * steckt in runPendingUnit — dieselbe Funktion, die auch der Minutentakt-Cron
 * pro Tick aufruft. Dieser Endpunkt bleibt als direkter Einzelaufruf bestehen
 * (Konsistenz mit /api/admin/glossary-crawl, das ebenfalls sowohl direkt als
 * auch über den Job aufrufbar ist), wird vom Panel aber nicht mehr benutzt.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { runPendingUnit } from '@/lib/glossary/pending-run'

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json().catch(() => null) as
    { postId?: string; confirmedSlugs?: string[] } | null
  if (!body?.postId) return NextResponse.json({ error: 'postId fehlt' }, { status: 400 })
  if (!Array.isArray(body.confirmedSlugs) || body.confirmedSlugs.length === 0) {
    return NextResponse.json({ error: 'confirmedSlugs fehlt' }, { status: 400 })
  }

  const supabase = createAdminClient()
  try {
    const result = await runPendingUnit(supabase, body.postId, body.confirmedSlugs)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Begriffs-Erzeugung fehlgeschlagen' },
      { status: 500 },
    )
  }
}
