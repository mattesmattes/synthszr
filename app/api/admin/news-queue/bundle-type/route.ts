import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Setzt das Label (bundle_type) einer News.
 *
 * Hängte bis 2026-09-28 einer von Hand gelabelten News die Techmeme-Story an,
 * wenn es genau eine aktive gab — damit sie nicht als eigener Abschnitt neben
 * dem Techmeme-Bündel lief (Prod 2026-09-11). Seit „ein Label, ein Abschnitt"
 * (computeBundleUnits) ist das überflüssig und wäre schädlich: Mit Story zählte
 * die News zur Quellen-Grenze dieser Story (capByUnits) und könnte gegen deren
 * Top-5 aus dem Abschnitt fallen.
 */
export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const { id, bundle_type } = await request.json()
  // Zulaessige Werte an EINER Stelle — dieselbe Liste wie der DB-Constraint
  // (Migration 20260913080000). Ohne 'cover_story' haette die Route den neuen
  // Knopf mit 400 abgelehnt, waehrend die Oberflaeche ihn anbietet.
  const ERLAUBT = ['topic', 'recap', 'deep_dive', 'cover_story']
  if (!id || (bundle_type !== null && !ERLAUBT.includes(bundle_type))) {
    return NextResponse.json({ error: 'Ungültige Parameter' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('news_queue').update({ bundle_type }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
