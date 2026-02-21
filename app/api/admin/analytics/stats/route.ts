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

function truncateDateKey(isoString: string, granularity: Granularity): string {
  const d = new Date(isoString)
  if (granularity === 'day') {
    return d.toISOString().split('T')[0]
  }
  if (granularity === 'month') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
  }
  // week: find the Monday of this week
  const dayOfWeek = d.getUTCDay()
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek))
  monday.setUTCHours(0, 0, 0, 0)
  return monday.toISOString().split('T')[0]
}

function generateBuckets(granularity: Granularity, startMs: number, endMs: number): string[] {
  const result: string[] = []
  const current = new Date(startMs)
  const end = new Date(endMs)

  // Normalize start to granularity boundary
  if (granularity === 'month') {
    current.setUTCDate(1)
    current.setUTCHours(0, 0, 0, 0)
  } else if (granularity === 'week') {
    const day = current.getUTCDay()
    current.setUTCDate(current.getUTCDate() + (day === 0 ? -6 : 1 - day))
    current.setUTCHours(0, 0, 0, 0)
  } else {
    current.setUTCHours(0, 0, 0, 0)
  }

  while (current <= end) {
    const key = current.toISOString().split('T')[0]
    const normalized = truncateDateKey(key, granularity)
    if (!result.includes(normalized)) result.push(normalized)

    if (granularity === 'day') current.setUTCDate(current.getUTCDate() + 1)
    else if (granularity === 'week') current.setUTCDate(current.getUTCDate() + 7)
    else current.setUTCMonth(current.getUTCMonth() + 1)
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
    const [analyticsResult, podcastResult, prevAnalyticsResult, prevPodcastResult] = await Promise.all([
      supabase
        .from('analytics_events')
        .select('event_type, created_at')
        .gte('created_at', currentStart),
      supabase
        .from('podcast_plays')
        .select('played_at')
        .gte('played_at', currentStart),
      supabase
        .from('analytics_events')
        .select('event_type, created_at')
        .gte('created_at', previousStart)
        .lt('created_at', currentStart),
      supabase
        .from('podcast_plays')
        .select('played_at')
        .gte('played_at', previousStart)
        .lt('played_at', currentStart),
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
