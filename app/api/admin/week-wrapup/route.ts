import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildWeekWrapup } from '@/lib/wrapup/build'

/**
 * Erzeugt den Wochenrückblick der letzten abgeschlossenen Woche als Entwurf —
 * auf Knopfdruck im Panel.
 *
 * Die Arbeit selbst steht in lib/wrapup/build.ts, weil sie sich diese Route mit
 * dem Sonntags-Cron teilt (app/api/cron/week-wrapup). Zwei Fassungen derselben
 * Logik liefen mit der Zeit auseinander.
 *
 * KEIN article_jobs-Eintrag: Der Job-Mechanismus existiert, weil 40 Sektionen à
 * 45-90s das 300s-Limit sprengen. Hier ist es EIN Aufruf über bis zu sechs
 * vorhandene Texte (~60-90s).
 */
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json().catch(() => ({}))

  try {
    // Ohne skipIfExists: Von Hand darf der Betreiber einen zweiten Rückblick
    // derselben Woche erzeugen — etwa wenn der erste misslungen ist.
    const r = await buildWeekWrapup(createAdminClient(), { model: body.model as string | undefined })
    if (r.status === 'no_topics') {
      // Klare Meldung statt eines leeren Entwurfs: der wäre in der Artikelliste
      // nicht von einem misslungenen zu unterscheiden.
      return NextResponse.json(
        { error: `Keine veröffentlichten Artikel im Zeitraum ${r.weekLabel} gefunden.` },
        { status: 400 },
      )
    }
    return NextResponse.json(r)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
    console.error('[WeekWrapup]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
