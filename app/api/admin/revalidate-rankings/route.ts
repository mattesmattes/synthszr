import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

/**
 * Leert den Rankings-Cache (Tag 'rankings') nach Daten-Änderungen (Konsolidierung,
 * Merges, Backfills) — ohne Deploy/Key-Bump und ohne die 600s-Revalidate abzuwarten.
 * Schutz: Secret = letzte 16 Zeichen des Service-Role-Keys.
 */
export async function POST(request: Request) {
  const secret = new URL(request.url).searchParams.get('secret')
  const expected = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').slice(-16)
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  revalidateTag('rankings', 'max')
  return NextResponse.json({ revalidated: true })
}
