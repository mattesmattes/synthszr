import { NextRequest, NextResponse } from 'next/server'
import { fetchDailyCounts } from '@/lib/analytics/daily-counts'
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

// Page-View unter den Synthszr Charts (/[lang]/rankings…). Matcht /de/rankings,
// /en/rankings/google-gemini-3-5 usw., aber nicht z.B. /de/xrankings.
// Page-View im Lexikon (/[lang]/glossary…). Matcht die Übersicht und die
// Begriffsseiten in jeder Sprache, aber nicht /de/xglossary oder /de/glossaryx.
//
// `/admin/` ist ausgenommen: /admin/glossary ist das Redaktionswerkzeug, keine
// Leser-Nutzung — sonst schriebe sich der Betreiber selbst in die Zahlen.
// Der Rankings-Filter braucht diese Ausnahme nicht, weil es unter /admin keine
// Rankings-Ansicht gibt.
export function isGlossaryPath(path: string | null | undefined): boolean {
  return !!path && !path.startsWith('/admin/') && /\/glossary(\/|$)/.test(path)
}

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

    // Serverseitig zaehlen statt Rohzeilen zu holen.
    //
    // BEFUND 2026-08-23: Die 3-Monats-Ansicht hing. Sie las JEDE Rohzeile fuer
    // Zeitraum UND Vergleichsperiode — ~100.000 Zeilen, ~15 MB, ~100
    // sequenzielle Requests (die Rohzeilen wurden paginiert) — und zaehlte sie in
    // JavaScript, um daraus 90 Balken zu machen. Jetzt liefert die Datenbank je
    // Metrik ~90 Tageswerte; die groeberen Raster (Woche/Monat) entstehen unten
    // aus den Tageswerten.
    //
    // Die Pfad-Filter sind gegen die alten JS-Regexe geprueft und liefern fuer
    // dasselbe 90-Tage-Fenster identische Zahlen (rankings 13098, glossary 13653).
    const RANKINGS_RE = '/rankings(/|$)'
    const GLOSSARY_RE = '/glossary(/|$)'
    const span = (from: string, to?: string) => ({ from, to })
    const cur = span(currentStart)
    const prev = span(previousStart, currentStart)

    const daily = (
      table: string, dateColumn: string, w: { from: string; to?: string },
      extra: Partial<Parameters<typeof fetchDailyCounts>[1]> = {},
    ) => fetchDailyCounts(supabase, { table, dateColumn, from: w.from, to: w.to, ...extra })

    const ev = (w: { from: string; to?: string }, extra = {}) =>
      daily('analytics_events', 'created_at', w, extra)

    const [
      pageViews, rankingsViews, glossaryViews, stockClicks, voteClicks, podcastEv, podcastTable,
      pPageViews, pRankingsViews, pGlossaryViews, pStockClicks, pVoteClicks, pPodcastEv, pPodcastTable,
    ] = await Promise.all([
      ev(cur, { eq: { event_type: 'page_view' } }),
      ev(cur, { eq: { event_type: 'page_view' }, match: { path: RANKINGS_RE } }),
      ev(cur, { eq: { event_type: 'page_view' }, match: { path: GLOSSARY_RE }, notLike: { path: '/admin/*' } }),
      ev(cur, { eq: { event_type: 'stock_ticker_click' } }),
      ev(cur, { eq: { event_type: 'synthszr_vote_click' } }),
      ev(cur, { eq: { event_type: 'podcast_play' } }),
      daily('podcast_plays', 'played_at', cur),
      ev(prev, { eq: { event_type: 'page_view' } }),
      ev(prev, { eq: { event_type: 'page_view' }, match: { path: RANKINGS_RE } }),
      ev(prev, { eq: { event_type: 'page_view' }, match: { path: GLOSSARY_RE }, notLike: { path: '/admin/*' } }),
      ev(prev, { eq: { event_type: 'stock_ticker_click' } }),
      ev(prev, { eq: { event_type: 'synthszr_vote_click' } }),
      ev(prev, { eq: { event_type: 'podcast_play' } }),
      daily('podcast_plays', 'played_at', prev),
    ])

    // Generate all buckets and initialize to zero
    const buckets = generateBuckets(granularity, now - lookbackMs, now)

    type BucketData = {
      page_views: number
      rankings_page_views: number
      glossary_page_views: number
      stock_ticker_clicks: number
      synthszr_vote_clicks: number
      podcast_plays: number
    }
    const countsMap = new Map<string, BucketData>()
    for (const b of buckets) {
      countsMap.set(b, { page_views: 0, rankings_page_views: 0, glossary_page_views: 0, stock_ticker_clicks: 0, synthszr_vote_clicks: 0, podcast_plays: 0 })
    }

    // Tageswerte in die (ggf. groeberen) Balken einsortieren. Mittag als
    // Uhrzeit, damit die Zeitzonen-Umrechnung nicht ueber die Tagesgrenze kippt.
    const intoBuckets = (m: Map<string, number>, feld: keyof BucketData) => {
      for (const [day, n] of m) {
        const bucket = countsMap.get(truncateDateKey(`${day}T12:00:00.000Z`, granularity))
        if (bucket) bucket[feld] += n
      }
    }
    intoBuckets(pageViews, 'page_views')
    intoBuckets(rankingsViews, 'rankings_page_views')
    intoBuckets(glossaryViews, 'glossary_page_views')
    intoBuckets(stockClicks, 'stock_ticker_clicks')
    intoBuckets(voteClicks, 'synthszr_vote_clicks')
    intoBuckets(podcastEv, 'podcast_plays')
    intoBuckets(podcastTable, 'podcast_plays')

    const summe = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)

    const events = buckets.map(date => ({ date, ...countsMap.get(date)! }))

    // Current period totals
    const totals = events.reduce(
      (acc, e) => ({
        page_views: acc.page_views + e.page_views,
        rankings_page_views: acc.rankings_page_views + e.rankings_page_views,
        glossary_page_views: acc.glossary_page_views + e.glossary_page_views,
        stock_ticker_clicks: acc.stock_ticker_clicks + e.stock_ticker_clicks,
        synthszr_vote_clicks: acc.synthszr_vote_clicks + e.synthszr_vote_clicks,
        podcast_plays: acc.podcast_plays + e.podcast_plays,
      }),
      { page_views: 0, rankings_page_views: 0, glossary_page_views: 0, stock_ticker_clicks: 0, synthszr_vote_clicks: 0, podcast_plays: 0 }
    )

    // Previous period totals (for % comparison) — ebenfalls aggregiert
    const previous_totals = {
      page_views: summe(pPageViews),
      rankings_page_views: summe(pRankingsViews),
      glossary_page_views: summe(pGlossaryViews),
      stock_ticker_clicks: summe(pStockClicks),
      synthszr_vote_clicks: summe(pVoteClicks),
      podcast_plays: summe(pPodcastEv) + summe(pPodcastTable),
    }

    // Subscriber data — same period window and granularity as events
    const [subNewResult, subChurnedResult, activeCountResult, activeLanguagesResult, activeByLangResult] = await Promise.all([
      supabase
        .from('subscribers')
        .select('confirmed_at, preferences')
        .not('confirmed_at', 'is', null)
        .gte('confirmed_at', currentStart),
      supabase
        .from('subscribers')
        .select('unsubscribed_at, preferences')
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
      supabase
        .from('subscribers')
        .select('preferences')
        .eq('status', 'active'),
    ])

    const activeLanguages = activeLanguagesResult.data ?? []
    const defaultLang = activeLanguages.find(l => l.is_default)?.code ?? 'de'
    const activeCodes = new Set(activeLanguages.map(l => l.code))

    const resolveLang = (prefs: unknown): string => {
      const p = prefs as { language?: string } | null
      const raw = p?.language || defaultLang
      return activeCodes.has(raw) ? raw : defaultLang
    }

    // Current active count per language (for running-total anchor)
    const currentActiveByLang: Record<string, number> = {}
    for (const code of activeCodes) currentActiveByLang[code] = 0
    for (const s of activeByLangResult.data || []) {
      const lang = resolveLang(s.preferences)
      currentActiveByLang[lang] = (currentActiveByLang[lang] ?? 0) + 1
    }

    const subNewMap = new Map<string, number>()
    // bucket -> langCode -> count
    const subNewByLangMap = new Map<string, Map<string, number>>()
    for (const s of subNewResult.data || []) {
      const key = truncateDateKey(s.confirmed_at, granularity)
      subNewMap.set(key, (subNewMap.get(key) || 0) + 1)
      const lang = resolveLang(s.preferences)
      const langCounts = subNewByLangMap.get(key) ?? new Map<string, number>()
      langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1)
      subNewByLangMap.set(key, langCounts)
    }
    const subChurnedMap = new Map<string, number>()
    const subChurnedByLangMap = new Map<string, Map<string, number>>()
    for (const s of subChurnedResult.data || []) {
      const key = truncateDateKey(s.unsubscribed_at, granularity)
      subChurnedMap.set(key, (subChurnedMap.get(key) || 0) + 1)
      const lang = resolveLang(s.preferences)
      const langCounts = subChurnedByLangMap.get(key) ?? new Map<string, number>()
      langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1)
      subChurnedByLangMap.set(key, langCounts)
    }

    // Build subscriber series aligned to same buckets as events
    const subRaw = buckets.map(date => {
      const newCount = subNewMap.get(date) || 0
      const churned = subChurnedMap.get(date) || 0
      const newByLang = subNewByLangMap.get(date) ?? new Map<string, number>()
      const churnedByLang = subChurnedByLangMap.get(date) ?? new Map<string, number>()
      const byLanguage: Record<string, number> = {}
      const churnedByLanguage: Record<string, number> = {}
      for (const code of activeCodes) {
        byLanguage[code] = newByLang.get(code) ?? 0
        churnedByLanguage[code] = churnedByLang.get(code) ?? 0
      }
      return { date, new: newCount, churned, net: newCount - churned, byLanguage, churnedByLanguage }
    })

    // Compute cumulative totals working backwards from current_active (total + per-language)
    const currentActive = activeCountResult.count || 0
    let runningTotal = currentActive
    const runningByLang: Record<string, number> = { ...currentActiveByLang }
    const period_data = [...subRaw].reverse().map(s => {
      const totalByLanguage: Record<string, number> = { ...runningByLang }
      const result = { ...s, total: runningTotal, totalByLanguage }
      runningTotal = runningTotal - s.net
      for (const code of activeCodes) {
        const netLang = (s.byLanguage[code] ?? 0) - (s.churnedByLanguage[code] ?? 0)
        runningByLang[code] = (runningByLang[code] ?? 0) - netLang
      }
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
