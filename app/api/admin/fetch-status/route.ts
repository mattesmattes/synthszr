import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildFetchStatus } from '@/lib/admin/fetch-status'

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
    // Tagesgrenze in Berliner Zeit — der Betreiber denkt in seinem Tag, nicht in UTC.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' })
    const from = new Date(`${today}T00:00:00+02:00`).toISOString()

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
    }))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
    console.error('[FetchStatus]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
