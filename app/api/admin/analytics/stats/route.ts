import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

type Period = 'day' | 'week' | 'month'

const LOOKBACK_MS: Record<Period, number> = {
  day: 30 * 24 * 60 * 60 * 1000,   // 30 days
  week: 84 * 24 * 60 * 60 * 1000,  // 12 weeks
  month: 365 * 24 * 60 * 60 * 1000, // 12 months
}

function truncateDateKey(isoString: string, period: Period): string {
  const d = new Date(isoString)
  if (period === 'day') {
    return d.toISOString().split('T')[0]
  }
  if (period === 'month') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
  }
  // week: find the Monday of this week
  const dayOfWeek = d.getUTCDay()
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek))
  monday.setUTCHours(0, 0, 0, 0)
  return monday.toISOString().split('T')[0]
}

function generateBuckets(period: Period, startMs: number, endMs: number): string[] {
  const result: string[] = []
  const current = new Date(startMs)
  const end = new Date(endMs)

  // Normalize start to period boundary
  if (period === 'month') {
    current.setUTCDate(1)
    current.setUTCHours(0, 0, 0, 0)
  } else if (period === 'week') {
    const day = current.getUTCDay()
    current.setUTCDate(current.getUTCDate() + (day === 0 ? -6 : 1 - day))
    current.setUTCHours(0, 0, 0, 0)
  } else {
    current.setUTCHours(0, 0, 0, 0)
  }

  while (current <= end) {
    const key = current.toISOString().split('T')[0]
    const normalized = truncateDateKey(key, period)
    if (!result.includes(normalized)) result.push(normalized)

    if (period === 'day') current.setUTCDate(current.getUTCDate() + 1)
    else if (period === 'week') current.setUTCDate(current.getUTCDate() + 7)
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
  const period = (searchParams.get('period') || 'day') as Period
  if (!['day', 'week', 'month'].includes(period)) {
    return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
  }

  try {
    const supabase = createAdminClient()
    const now = Date.now()
    const lookback = LOOKBACK_MS[period]
    const currentStart = new Date(now - lookback).toISOString()
    const previousStart = new Date(now - 2 * lookback).toISOString()

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
    const buckets = generateBuckets(period, now - lookback, now)

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
      const key = truncateDateKey(event.created_at, period)
      const bucket = countsMap.get(key)
      if (!bucket) continue
      if (event.event_type === 'page_view') bucket.page_views++
      else if (event.event_type === 'stock_ticker_click') bucket.stock_ticker_clicks++
      else if (event.event_type === 'synthszr_vote_click') bucket.synthszr_vote_clicks++
    }

    // Aggregate podcast_plays
    for (const play of podcastResult.data || []) {
      const key = truncateDateKey(play.played_at, period)
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

    // Subscriber data
    const twoYearsAgo = new Date(now - 24 * 30 * 24 * 60 * 60 * 1000).toISOString()

    const [newSubsResult, churnedSubsResult, allNewSubsResult, allChurnedSubsResult, activeCountResult] =
      await Promise.all([
        supabase
          .from('subscribers')
          .select('confirmed_at')
          .not('confirmed_at', 'is', null)
          .gte('confirmed_at', twoYearsAgo),
        supabase
          .from('subscribers')
          .select('unsubscribed_at')
          .not('unsubscribed_at', 'is', null)
          .gte('unsubscribed_at', twoYearsAgo),
        supabase
          .from('subscribers')
          .select('confirmed_at')
          .not('confirmed_at', 'is', null),
        supabase
          .from('subscribers')
          .select('unsubscribed_at')
          .not('unsubscribed_at', 'is', null),
        supabase
          .from('subscribers')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active'),
      ])

    // Monthly aggregation (last 24 months)
    const monthlyNewMap = new Map<string, number>()
    for (const s of newSubsResult.data || []) {
      const key = truncateDateKey(s.confirmed_at, 'month')
      monthlyNewMap.set(key, (monthlyNewMap.get(key) || 0) + 1)
    }
    const monthlyChurnedMap = new Map<string, number>()
    for (const s of churnedSubsResult.data || []) {
      const key = truncateDateKey(s.unsubscribed_at, 'month')
      monthlyChurnedMap.set(key, (monthlyChurnedMap.get(key) || 0) + 1)
    }
    const monthlyBuckets = generateBuckets('month', now - 24 * 30 * 24 * 60 * 60 * 1000, now)
    const monthly = monthlyBuckets.map(month => {
      const newCount = monthlyNewMap.get(month) || 0
      const churned = monthlyChurnedMap.get(month) || 0
      return { month, new: newCount, churned, net: newCount - churned }
    })

    // Yearly aggregation (all time)
    const yearlyNewMap = new Map<string, number>()
    for (const s of allNewSubsResult.data || []) {
      const year = new Date(s.confirmed_at).getUTCFullYear().toString()
      yearlyNewMap.set(year, (yearlyNewMap.get(year) || 0) + 1)
    }
    const yearlyChurnedMap = new Map<string, number>()
    for (const s of allChurnedSubsResult.data || []) {
      const year = new Date(s.unsubscribed_at).getUTCFullYear().toString()
      yearlyChurnedMap.set(year, (yearlyChurnedMap.get(year) || 0) + 1)
    }
    const allYears = [
      ...new Set([...yearlyNewMap.keys(), ...yearlyChurnedMap.keys()]),
    ].sort()
    const yearly = allYears.map(year => {
      const newCount = yearlyNewMap.get(year) || 0
      const churned = yearlyChurnedMap.get(year) || 0
      return { year, new: newCount, churned, net: newCount - churned }
    })

    return NextResponse.json({
      period,
      events,
      totals,
      previous_totals,
      subscribers: {
        monthly,
        yearly,
        current_active: activeCountResult.count || 0,
      },
    })
  } catch (error) {
    console.error('[Stats API] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
