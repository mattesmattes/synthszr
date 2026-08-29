import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { runTechmemeJob } from '@/lib/techmeme/job'

/**
 * POST /api/admin/techmeme-run — den Techmeme-Lauf von Hand anstossen.
 *
 * Derselbe Job wie in app/api/cron/techmeme (alle vier Stunden). Bisher liess
 * er sich nur ueber das Vercel-Dashboard ausloesen; im Admin gab es keinen Weg.
 *
 * maxDuration wie beim Cron: Bis zu 13 Stories mal 10 Quellen sind 130 Abrufe,
 * ueberwiegend Crawls. Der Job hoert von selbst auf, wenn sein Zeitbudget
 * aufgebraucht ist, und meldet im Feld `offen`, was liegen blieb — ein zweiter
 * Klick holt es nach.
 *
 * Anders als der Cron gibt diese Route einen FEHLER zurueck, wenn der Lauf
 * scheitert. Der Cron antwortet bewusst immer mit 200, damit Vercel nicht wegen
 * eines fremden Servers Alarm schlaegt; hier steht ein Mensch davor, der das
 * Ergebnis sehen will.
 */
export const maxDuration = 300

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  try {
    const result = await runTechmemeJob(createAdminClient())
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
    console.error('[admin/techmeme-run]', err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
