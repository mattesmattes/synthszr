import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Leichter Zähler der Kommentare in der Freigabe-Queue — für den rot
 * blinkenden „Eure Takes"-Indikator in der Admin-Navigation. `head: true` +
 * `count: 'exact'` überträgt nur die Zahl, keine Zeilen.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from('post_comments')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) return NextResponse.json({ count: 0 })
  return NextResponse.json({ count: count ?? 0 })
}
