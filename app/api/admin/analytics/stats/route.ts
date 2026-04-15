import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

type Period = '7d' | '30d' | '90d' | '1y'
type Granularity = 'day' | 'week' | 'month'

const PERIOD_CONFIG: Record<Period, { lookbackMs: number; granularity: Granularity }> = {
  '7d':  { lookbackMs: 7 * 24 * 60 * 60 * 1000,   granularity: 'day' },
  '30d': { lookbackMs: 30 * 24 * 60 * 60 * 1000,  granularity: 'day' },
  '90d': { lookbackMs: 90 * 24 * 60 * 60 * 1000,  granularity: 'week' },
  '1y':  { lookbackMs: 365 * 24 * 60 * 60 * 1000, granularity: 'month' },
}

const BERLIN_TZ = 'Europe/Berlin'

// Returns "YYYY-MM-DD" string in Europe/Berlin local time
function toBerlinDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BERLIN_TZ }).format(d)
}

function truncateDateKey(isoString: string, granularity: Granularity): string {
  const d = new Date(isoString)
  const berlinDate = toBerlinDateStr(d) // "YYYY-MM-DD" in MEZ/MESZ

  if (granularity === 'day') {
    return berlinDate
  }
  if (granularity === 'month') {
    return berlinDate.substring(0, 7) + '-01'
  }
  // week: find the Monday of this Berlin week
  // Use noon UTC of the Berlin date to safely compute day-of-week without DST artifacts
  const [y, m, day] = berlinDate.split('-').map(Number)
  const noonUtc = new Date(Date.UTC(y, m - 1, day, 12, 0, 0))
  const dow = noonUtc.getUTCDay() // 0=Sun, 1=Mon … 6=Sat
  const daysToMonday = dow === 0 ? -6 : 1 - dow
  return toBerlinDateStr(new Date(Date.UTC(y, m - 1, day + daysToMonday, 12, 0, 0)))
}

function generateBuckets(granularity: Granularity, startMs: number, endMs: number): string[] {
  const result: string[] = []

  let current = toBerlinDateStr(new Date(startMs)) // "YYYY-MM-DD" in Berlin
  const end = toBerlinDateStr(new Date(endMs))

  // Normalize start to granularity boundary
  if (granularity === 'month') {
    current = current.substring(0, 7) + '-01'
  } else if (granularity === 'week') {
    current = truncateDateKey(new Date(current + 'T12:00:00Z').toISOString(), 'week')
  }

  while (current <= end) {
    const key = truncateDateKey(new Date(current + 'T12:00:00Z').toISOString(), granularity)
    if (!result.includes(key)) result.push(key)

    const [y, m, day] = current.split('-').map(Number)
    if (granularity === 'day') {
      current = toBerlinDateStr(new Date(Date.UTC(y, m - 1, day + 1, 12, 0, 0)))
    } else if (granularity === 'week') {
      current = toBerlinDateStr(new Date(Date.UTC(y, m - 1, day + 7, 12, 0, 0)))
    } else {
      // First day of next month at noon UTC
      current = toBerlinDateStr(new Date(Date.UTC(y, m, 1, 12, 0, 0))).substring(0, 7) + '-01'
    }
  }

  return result
}

/**
 * Paginated fetch to bypass PostgREST max-rows (default 1000).
 * Fetches in PAGE_SIZE batches using .range() until all rows are returned.
 */
const PAGE_SIZE = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllRows<T = any>(
  queryBuilder: any
): Promise<T[]> {
  const allRows: T[] = []
  let offset = 0

  while (true) {
    const { data, error } = await queryBuilder.range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    allRows.push(...(data as T[]))
    if (data.length < PAGE_SIZE) break // last page
    offset += PAGE_SIZE
  }

  return allRows
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const period = (searchParams.get('period') || '7d') as Period
  if (!Object.keys(PERIOD_CONFIG).includes(period)) {
    return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
  }

  const { lookbackMs, granularity } = PERIOD_CONFIG[period]

  try {
    const supabase = createAdminClient()
    const now = Date.now()
    const currentStart = new Date(now - lookbackMs).toISOString()
    const previousStart = new Date(now - 2 * lookbackMs).toISOString()

    // Fetch current + previous period in parallel using pagination
    // PostgREST caps at 1000 rows per request regardless of .limit() — must paginate with .range()
    const [analyticsData, podcastData, prevAnalyticsData, prevPodcastData] = await Promise.all([
      fetchAllRows<{ event_type: string; created_at: string }>(
        supabase
          .from('analytics_events')
          .select('event_type, created_at')
          .gte('created_at', currentStart)
          .order('created_at', { ascending: false })
      ),
      fetchAllRows<{ played_at: string }>(
        supabase
          .from('podcast_plays')
          .select('played_at')
          .gte('played_at', currentStart)
          .order('played_at', { ascending: false })
      ),
      fetchAllRows<{ event_type: string; created_at: string }>(
        supabase
          .from('analytics_events')
          .select('event_type, created_at')
          .gte('created_at', previousStart)
          .lt('created_at', currentStart)
          .order('created_at', { ascending: false })
      ),
      fetchAllRows<{ played_at: string }>(
        supabase
          .from('podcast_plays')
          .select('played_at')
          .gte('played_at', previousStart)
          .lt('played_at', currentStart)
          .order('played_at', { ascending: false })
      ),
    ])

    // Generate all buckets and initialize to zero
    const buckets = generateBuckets(granularity, now - lookbackMs, now)

    type BucketData = {
      page_views: number
      stock_ticker_clicks: number
      synthszr_vote_clicks: number
      podcast_plays: number
    }
    const countsMap = new Map<string, BucketData>()
    for (const b of buckets) {
      countsMap.set(b, { page_views: 0, stock_ticker_clicks: 0, synthszr_vote_clicks: 0, podcast_plays: 0 })
    }

    // Aggregate analytics_events
    for (const event of analyticsData) {
      const key = truncateDateKey(event.created_at, granularity)
      const bucket = countsMap.get(key)
      if (!bucket) continue
      if (event.event_type === 'page_view') bucket.page_views++
      else if (event.event_type === 'stock_ticker_click') bucket.stock_ticker_clicks++
      else if (event.event_type === 'synthszr_vote_click') bucket.synthszr_vote_clicks++
      else if (event.event_type === 'podcast_play') bucket.podcast_plays++
    }

    // Aggregate podcast_plays
    for (const play of podcastData) {
      const key = truncateDateKey(play.played_at, granularity)
      const bucket = countsMap.get(key)
      if (!bucket) continue
      bucket.podcast_plays++
    }

    const events = buckets.map(date => ({ date, ...countsMap.get(date)! }))

    // Current period totals
    const totals = events.reduce(
      (acc, e) => ({
        page_views: acc.page_views + e.page_views,
        stock_ticker_clicks: acc.stock_ticker_clicks + e.stock_ticker_clicks,
        synthszr_vote_clicks: acc.synthszr_vote_clicks + e.synthszr_vote_clicks,
        podcast_plays: acc.podcast_plays + e.podcast_plays,
      }),
      { page_views: 0, stock_ticker_clicks: 0, synthszr_vote_clicks: 0, podcast_plays: 0 }
    )

    // Previous period totals (for % comparison)
    const previous_totals = {
      page_views: prevAnalyticsData.filter(e => e.event_type === 'page_view').length,
      stock_ticker_clicks: prevAnalyticsData.filter(e => e.event_type === 'stock_ticker_click').length,
      synthszr_vote_clicks: prevAnalyticsData.filter(e => e.event_type === 'synthszr_vote_click').length,
      podcast_plays: prevPodcastData.length,
    }

    // Subscriber data — same period window and granularity as events
    const [subNewResult, subChurnedResult, activeCountResult, activeLanguagesResult] = await Promise.all([
      supabase
        .from('subscribers')
        .select('confirmed_at, preferences')
        .not('confirmed_at', 'is', null)
        .gte('confirmed_at', currentStart),
      supabase
        .from('subscribers')
        .select('unsubscribed_at')
        .not('unsubscribed_at', 'is', null)
        .gte('unsubscribed_at', currentStart),
      supabase
        .from('subscribers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
      supabase
        .from('languages')
        .select('code, native_name, name, is_default')
        .eq('is_active', true),
    ])

    const activeLanguages = activeLanguagesResult.data ?? []
    const defaultLang = activeLanguages.find(l => l.is_default)?.code ?? 'de'
    const activeCodes = new Set(activeLanguages.map(l => l.code))

    const subNewMap = new Map<string, number>()
    // bucket -> langCode -> count
    const subNewByLangMap = new Map<string, Map<string, number>>()
    for (const s of subNewResult.data || []) {
      const key = truncateDateKey(s.confirmed_at, granularity)
      subNewMap.set(key, (subNewMap.get(key) || 0) + 1)

      const prefs = s.preferences as { language?: string } | null
      const rawLang = prefs?.language || defaultLang
      const lang = activeCodes.has(rawLang) ? rawLang : defaultLang
      const langCounts = subNewByLangMap.get(key) ?? new Map<string, number>()
      langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1)
      subNewByLangMap.set(key, langCounts)
    }
    const subChurnedMap = new Map<string, number>()
    for (const s of subChurnedResult.data || []) {
      const key = truncateDateKey(s.unsubscribed_at, granularity)
      subChurnedMap.set(key, (subChurnedMap.get(key) || 0) + 1)
    }

    // Build subscriber series aligned to same buckets as events
    const subRaw = buckets.map(date => {
      const newCount = subNewMap.get(date) || 0
      const churned = subChurnedMap.get(date) || 0
      const langCounts = subNewByLangMap.get(date) ?? new Map<string, number>()
      const byLanguage: Record<string, number> = {}
      for (const code of activeCodes) byLanguage[code] = langCounts.get(code) ?? 0
      return { date, new: newCount, churned, net: newCount - churned, byLanguage }
    })

    // Compute cumulative total working backwards from current_active
    const currentActive = activeCountResult.count || 0
    let runningTotal = currentActive
    const period_data = [...subRaw].reverse().map(s => {
      const result = { ...s, total: runningTotal }
      runningTotal = runningTotal - s.net
      return result
    }).reverse()

    return NextResponse.json({
      period,
      granularity,
      events,
      totals,
      previous_totals,
      subscribers: {
        period_data,
        current_active: currentActive,
        active_languages: activeLanguages.map(l => ({ code: l.code, name: l.name, native_name: l.native_name })),
      },
    })
  } catch (error) {
    console.error('[Stats API] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
