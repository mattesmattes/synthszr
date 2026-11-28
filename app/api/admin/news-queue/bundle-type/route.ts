import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { readStatusSnapshot, recordQueueEvents } from '@/lib/news-queue/events'
import { isBundleType } from '@/lib/i18n/bundle-labels'

const IN_CHUNK = 200

/**
 * Setzt das Label (bundle_type) einer oder mehrerer News.
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
  const body = await request.json()
  const { id, ids, bundle_type } = body as {
    id?: unknown
    ids?: unknown
    bundle_type?: unknown
  }

  // Zulässige Werte über isBundleType / BUNDLE_TYPES (dieselbe Liste wie der
  // DB-Constraint, Migration 20261123210000).
  if (bundle_type !== null && !isBundleType(bundle_type)) {
    return NextResponse.json({ error: 'Ungültige Parameter' }, { status: 400 })
  }

  const isBatch = Array.isArray(ids)
  let targetIds: string[] = []
  if (isBatch) {
    targetIds = [...new Set(ids.filter((v): v is string => typeof v === 'string' && v.trim().length > 0))]
    if (targetIds.length === 0) {
      return NextResponse.json({ error: 'Ungültige Parameter' }, { status: 400 })
    }
  } else if (typeof id === 'string' && id.trim().length > 0) {
    targetIds = [id]
  } else {
    return NextResponse.json({ error: 'Ungültige Parameter' }, { status: 400 })
  }

  const supabase = createAdminClient()
  // from_role VOR dem Update lesen — danach steht nur noch der neue Wert in der
  // Zeile. readStatusSnapshot wirft nie (Task 3); ein Lesefehler kostet nur
  // from_role, nicht das Label.
  const vorher = await readStatusSnapshot(supabase, targetIds)

  const updatedIds: string[] = []
  if (isBatch) {
    for (let i = 0; i < targetIds.length; i += IN_CHUNK) {
      const chunk = targetIds.slice(i, i + IN_CHUNK)
      const { data, error } = await supabase
        .from('news_queue')
        .update({ bundle_type })
        .in('id', chunk)
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      for (const row of (data ?? []) as Array<{ id: string }>) {
        updatedIds.push(row.id)
      }
    }
  } else {
    // .select('id') nur fuer die Trefferzahl: queue_item_events hat keinen FK auf
    // news_queue (Vertrag 2.1), ein Event fuer eine unbekannte id waere eine
    // Waise. Die Response bleibt wie bisher { ok: true }, auch ohne Treffer.
    const { data, error } = await supabase
      .from('news_queue')
      .update({ bundle_type })
      .eq('id', targetIds[0])
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const row of (data ?? []) as Array<{ id: string }>) {
      updatedIds.push(row.id)
    }
  }

  if (updatedIds.length > 0) {
    // relabel-Event (Betreiber-Vorgabe 2026-10-05, Spec „Herkunft und Hand-Begriff"):
    // Ein Label vom Betreiber macht ein Techmeme- oder Agent-Item zum bestaetigten
    // Hand-Item — isConfirmedByOperator liest genau dieses Event. Best-effort.
    await recordQueueEvents(
      supabase,
      updatedIds.map((rowId) => ({
        queue_item_id: rowId,
        event: 'relabel' as const,
        actor: 'operator' as const,
        from_role: vorher.get(rowId)?.bundle_type ?? null,
        to_role: bundle_type,
      })),
    )
  }

  if (isBatch) {
    return NextResponse.json({ ok: true, updated: updatedIds.length })
  }
  return NextResponse.json({ ok: true })
}
