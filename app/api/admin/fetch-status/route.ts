import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildFetchStatus } from '@/lib/admin/fetch-status'
import { DEFAULT_SCHEDULE_TIMEZONE, isValidTimeZone, localMidnightIso } from '@/lib/scheduler/clock'

/**
 * Wie viele Quellartikel wurden HEUTE eingesammelt?
 *
 * Hintergrund s. lib/admin/fetch-status.ts: Am 2026-08-23 lief der Abruf um
 * 03:46 ins Leere (die Newsletter kamen an dem Tag erst gegen 07:00), galt aber
 * als erledigt — und ohne Quellmaterial fiel die Tagesanalyse und mit ihr der
 * Artikel aus. Sichtbar war das nirgends.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  try {
    const supabase = createAdminClient()
    // Tagesgrenze in der Zone des Zeitplans (schedule_config.timezone), nicht
    // fest in Berlin: Befund 2026-11-01 — Zeitplan auf Asia/Shanghai, Abruf um
    // 04:11 Ortszeit, die Ampel meldete „kein Abruf heute" (und rechnete obendrein
    // mit festem +02:00, seit der Zeitumstellung eine Stunde daneben).
    const now = new Date()
    const { data: sched } = await supabase.from('settings').select('value').eq('key', 'schedule_config').maybeSingle()
    const rawTz = (sched as { value?: { timezone?: unknown } } | null)?.value?.timezone
    const tz = isValidTimeZone(typeof rawTz === 'string' ? rawTz : null) ? (rawTz as string) : DEFAULT_SCHEDULE_TIMEZONE
    const from = localMidnightIso(now, tz)

    const [{ count }, { count: processed }, marks] = await Promise.all([
      supabase.from('daily_repo').select('id', { count: 'exact', head: true }).gte('collected_at', from),
      // news_queue = was aus den Rohartikeln tatsaechlich als News herausgefiltert
      // wurde. Diese Zahl entscheidet die Ampel, nicht die Rohmenge.
      supabase.from('news_queue').select('id', { count: 'exact', head: true }).gte('queued_at', from),
      supabase.from('settings').select('key, value').in('key', ['last_run_newsletter_fetch', 'last_run_webcrawl_fetch']),
    ])

    const val = (k: string) => {
      const row = (marks.data ?? []).find((m) => (m as { key: string }).key === k)
      return ((row as { value?: { timestamp?: string } } | undefined)?.value?.timestamp) ?? null
    }

    return NextResponse.json(buildFetchStatus({
      articleCount: count ?? 0,
      processedCount: processed ?? 0,
      lastNewsletterFetch: val('last_run_newsletter_fetch'),
      lastWebcrawl: val('last_run_webcrawl_fetch'),
      now,
      tz,
    }))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
    console.error('[FetchStatus]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
