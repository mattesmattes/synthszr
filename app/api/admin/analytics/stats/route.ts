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

    // Fetch current + previous period in parallel
    // NOTE: Supabase has a default 1000-row limit — use explicit limit to avoid losing recent events.
    // At ~500 events/day, 100k covers ~200 days; well within Vercel memory limits (~5 MB payload).
    const ROW_LIMIT = 100000
    const [analyticsResult, podcastResult, prevAnalyticsResult, prevPodcastResult] = await Promise.all([
      supabase
        .from('analytics_events')
        .select('event_type, created_at')
        .gte('created_at', currentStart)
        .order('created_at', { ascending: false })
        .limit(ROW_LIMIT),
      supabase
        .from('podcast_plays')
        .select('played_at')
        .gte('played_at', currentStart)
        .order('played_at', { ascending: false })
        .limit(ROW_LIMIT),
      supabase
        .from('analytics_events')
        .select('event_type, created_at')
        .gte('created_at', previousStart)
        .lt('created_at', currentStart)
        .order('created_at', { ascending: false })
        .limit(ROW_LIMIT),
      supabase
        .from('podcast_plays')
        .select('played_at')
        .gte('played_at', previousStart)
        .lt('played_at', currentStart)
        .order('played_at', { ascending: false })
        .limit(ROW_LIMIT),
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
    for (const event of analyticsResult.data || []) {
      const key = truncateDateKey(event.created_at, granularity)
      const bucket = countsMap.get(key)
      if (!bucket) continue
      if (event.event_type === 'page_view') bucket.page_views++
      else if (event.event_type === 'stock_ticker_click') bucket.stock_ticker_clicks++
      else if (event.event_type === 'synthszr_vote_click') bucket.synthszr_vote_clicks++
      else if (event.event_type === 'podcast_play') bucket.podcast_plays++
    }

    // Aggregate podcast_plays
    for (const play of podcastResult.data || []) {
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
    const prevEvents = prevAnalyticsResult.data || []
    const previous_totals = {
      page_views: prevEvents.filter(e => e.event_type === 'page_view').length,
      stock_ticker_clicks: prevEvents.filter(e => e.event_type === 'stock_ticker_click').length,
      synthszr_vote_clicks: prevEvents.filter(e => e.event_type === 'synthszr_vote_click').length,
      podcast_plays: (prevPodcastResult.data || []).length,
    }

    // Subscriber data — same period window and granularity as events
    const [subNewResult, subChurnedResult, activeCountResult] = await Promise.all([
      supabase
        .from('subscribers')
        .select('confirmed_at')
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
    ])

    const subNewMap = new Map<string, number>()
    for (const s of subNewResult.data || []) {
      const key = truncateDateKey(s.confirmed_at, granularity)
      subNewMap.set(key, (subNewMap.get(key) || 0) + 1)
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
      return { date, new: newCount, churned, net: newCount - churned }
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
      },
    })
  } catch (error) {
    console.error('[Stats API] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
