import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { listRecentComments } from '@/lib/comments/recent'

/**
 * Neue Leser-Takes der letzten Stunden (Default 48, höchstens 168) für die
 * Info-Box auf /admin. Nur lesend, nur mit Admin-Session.
 */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const raw = Number(request.nextUrl.searchParams.get('hours'))
  const hours = Number.isFinite(raw) && raw > 0 ? Math.min(168, Math.max(1, Math.floor(raw))) : 48

  try {
    return NextResponse.json(await listRecentComments(createAdminClient(), { hours }))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
    console.error('[RecentComments]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
