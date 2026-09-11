import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { bundleKeyOf } from '@/lib/claude/queue-article'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Story-Schluessel EINES bereits aktiven Themen-Bündels, wenn es genau eines
 * gibt — sonst null.
 *
 * WARUM: `bundleKeyOf` (queue-article.ts) und darüber computeBundleUnits
 * (ghostwriter-pipeline.ts) gruppieren Abschnitte nach `metadata.techmeme_story`.
 * Von Hand als "Thema des Tages" markierte Items haben dieses Feld nie — sie
 * fallen auf den generischen Schluessel "topic" zurueck. Deckt sich das
 * manuell markierte Item inhaltlich mit einer Techmeme-Story, die schon als
 * eigenes Bündel läuft (anderer Schluessel), entstehen daraus ZWEI Abschnitte
 * statt einem — PROD-BEFUND 2026-09-11 an "DeepSeek V4.1-Flash": zwei von Hand
 * markierte Artikel liefen getrennt von zwei Techmeme-Quellen zur selben
 * Meldung.
 *
 * Nur bei GENAU EINEM aktiven Schluessel greift das automatisch — bei keinem
 * oder mehreren waere das Raten, welche Story gemeint ist, und der Bestand
 * bleibt lieber unveraendert (alter, generischer Bucket) als falsch verknuepft.
 */
async function findSoleActiveTopicStoryKey(supabase: AdminClient): Promise<string | null> {
  const { data, error } = await supabase
    .from('news_queue')
    .select('metadata')
    .eq('status', 'selected')
    .eq('bundle_type', 'topic')
    .range(0, 999)
  if (error || !data) return null

  const keys = new Set<string>()
  for (const row of data as Array<{ metadata: Record<string, unknown> | null }>) {
    const key = bundleKeyOf(row.metadata)
    if (key) keys.add(key)
  }
  return keys.size === 1 ? [...keys][0] : null
}

export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const { id, bundle_type } = await request.json()
  // Zulaessige Werte an EINER Stelle — dieselbe Liste wie der DB-Constraint
  // (Migration 20260813120000). Ohne 'deep_dive' haette die Route den neuen
  // Knopf mit 400 abgelehnt, waehrend die Oberflaeche ihn anbietet.
  const ERLAUBT = ['topic', 'recap', 'deep_dive']
  if (!id || (bundle_type !== null && !ERLAUBT.includes(bundle_type))) {
    return NextResponse.json({ error: 'Ungültige Parameter' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const patch: Record<string, unknown> = { bundle_type }

  if (bundle_type === 'topic') {
    const { data: current } = await supabase
      .from('news_queue')
      .select('metadata')
      .eq('id', id)
      .single()
    const currentMetadata = (current?.metadata ?? {}) as Record<string, unknown>

    if (!bundleKeyOf(currentMetadata)) {
      const soleKey = await findSoleActiveTopicStoryKey(supabase)
      if (soleKey) patch.metadata = { ...currentMetadata, techmeme_story: soleKey }
    }
  }

  const { error } = await supabase.from('news_queue').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
