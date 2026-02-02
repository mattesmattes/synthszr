import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/session'

export const runtime = 'nodejs'

/**
 * GET: Debug daily_repo content
 * Query params:
 * - date: specific date (YYYY-MM-DD) or "recent" for last 7 days
 */
export async function GET(request: NextRequest) {
  // Always require admin auth
  const authError = await requireAdmin(request)
  if (authError) return authError

  const supabase = createAdminClient()
  const { searchParams } = new URL(request.url)
  const dateParam = searchParams.get('date')

  const debug: Record<string, unknown> = {}

  // Get items by date for the last 14 days
  const dates: string[] = []
  for (let i = 0; i < 14; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().split('T')[0])
  }

  // Count items per date
  const dateCounts: Record<string, { total: number; newsletters: number; articles: number }> = {}

  for (const date of dates) {
    const { count: total } = await supabase
      .from('daily_repo')
      .select('id', { count: 'exact', head: true })
      .eq('newsletter_date', date)

    const { count: newsletters } = await supabase
      .from('daily_repo')
      .select('id', { count: 'exact', head: true })
      .eq('newsletter_date', date)
      .eq('source_type', 'newsletter')

    const { count: articles } = await supabase
      .from('daily_repo')
      .select('id', { count: 'exact', head: true })
      .eq('newsletter_date', date)
      .eq('source_type', 'article')

    dateCounts[date] = {
      total: total || 0,
      newsletters: newsletters || 0,
      articles: articles || 0,
    }
  }

  debug.itemsByDate = dateCounts

  // Get detailed items for specific date
  const targetDate = dateParam || dates[0]

  const { data: items, error: itemsError } = await supabase
    .from('daily_repo')
    .select('id, title, source_type, source_email, source_url, collected_at, newsletter_date')
    .eq('newsletter_date', targetDate)
    .order('collected_at', { ascending: false })

  if (itemsError) {
    debug.error = itemsError.message
  } else {
    // Group by source
    const bySource: Record<string, Array<{ title: string; type: string; url?: string }>> = {}

    for (const item of items || []) {
      const sourceKey = item.source_email || item.source_type || 'unknown'
      if (!bySource[sourceKey]) {
        bySource[sourceKey] = []
      }
      bySource[sourceKey].push({
        title: item.title?.slice(0, 80) || 'No title',
        type: item.source_type,
        url: item.source_url?.slice(0, 60),
      })
    }

    debug.targetDate = targetDate
    debug.totalItems = items?.length || 0
    debug.bySource = bySource
    debug.sourceCounts = Object.fromEntries(
      Object.entries(bySource).map(([k, v]) => [k, v.length])
    )
  }

  // Check last newsletter fetch timestamp
  const { data: settings } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'last_newsletter_fetch')
    .single()

  debug.lastFetch = settings?.value?.timestamp || 'Never'

  // Get newsletter sources
  const { data: sources } = await supabase
    .from('newsletter_sources')
    .select('email, name, enabled')
    .order('name')

  debug.newsletterSources = sources?.map(s => ({
    email: s.email,
    name: s.name,
    enabled: s.enabled,
  }))

  return NextResponse.json(debug)
}
