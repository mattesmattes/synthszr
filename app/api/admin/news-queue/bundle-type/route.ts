import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { readStatusSnapshot, recordQueueEvents } from '@/lib/news-queue/events'

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
  // from_role VOR dem Update lesen — danach steht nur noch der neue Wert in der
  // Zeile. readStatusSnapshot wirft nie (Task 3); ein Lesefehler kostet nur
  // from_role, nicht das Label.
  const vorher = await readStatusSnapshot(supabase, [id])
  // .select('id') nur fuer die Trefferzahl: queue_item_events hat keinen FK auf
  // news_queue (Vertrag 2.1), ein Event fuer eine unbekannte id waere eine
  // Waise. Die Response bleibt wie bisher { ok: true }, auch ohne Treffer.
  const { data, error } = await supabase.from('news_queue').update({ bundle_type }).eq('id', id).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (data && data.length > 0) {
    // relabel-Event (Betreiber-Vorgabe 2026-10-05, Spec „Herkunft und Hand-Begriff"):
    // Ein Label vom Betreiber macht ein Techmeme- oder Agent-Item zum bestaetigten
    // Hand-Item — isConfirmedByOperator liest genau dieses Event. Best-effort.
    await recordQueueEvents(supabase, [{
      queue_item_id: id,
      event: 'relabel',
      actor: 'operator',
      from_role: vorher.get(id)?.bundle_type ?? null,
      to_role: bundle_type,
    }])
  }
  return NextResponse.json({ ok: true })
}
