'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, Eye, Headphones, MousePointerClick, Loader2, Users } from 'lucide-react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ComposedChart,
  Bar,
  BarChart,
  Cell,
  LabelList,
} from 'recharts'

type Period = '7d' | '30d' | '90d' | '1y'
type Granularity = 'day' | 'week' | 'month'

interface PodigeeDay {
  date: string
  total: number
  apple: number
  spotify: number
}

interface PodigeeStats {
  period: Period
  days: PodigeeDay[]
  totals: { total: number; apple: number; spotify: number }
}

interface YouTubeDay {
  date: string
  views: number
}

interface YouTubeStats {
  period: Period
  days: YouTubeDay[]
  totals: { views: number; subscribers: number }
  channelTitle: string | null
}

const PERIOD_GRANULARITY: Record<Period, Granularity> = {
  '7d': 'day',
  '30d': 'day',
  '90d': 'week',
  '1y': 'month',
}

interface EventData {
  date: string
  page_views: number
  stock_ticker_clicks: number
  synthszr_vote_clicks: number
  podcast_plays: number
}

interface Totals {
  page_views: number
  stock_ticker_clicks: number
  synthszr_vote_clicks: number
  podcast_plays: number
}

interface SubscriberEntry {
  date: string
  new: number
  churned: number
  net: number
  total: number
}

interface StatsResponse {
  period: Period
  granularity: Granularity
  events: EventData[]
  totals: Totals
  previous_totals: Totals
  subscribers: {
    period_data: (SubscriberEntry & { byLanguage?: Record<string, number> })[]
    current_active: number
    active_languages?: { code: string; name: string; native_name: string | null }[]
  }
}

function getDateBucket(dateStr: string, granularity: Granularity): string {
  const d = new Date(dateStr)
  if (granularity === 'month') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
  }
  if (granularity === 'week') {
    const day = d.getUTCDay()
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day))
    monday.setUTCHours(0, 0, 0, 0)
    return monday.toISOString().split('T')[0]
  }
  return dateStr.substring(0, 10)
}

function formatDateLabel(dateStr: string, granularity: Granularity): string {
  const date = new Date(dateStr)
  if (granularity === 'month') {
    return date.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' })
  }
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })
}

function formatChange(current: number, previous: number): { value: string; positive: boolean } | null {
  if (previous === 0) return null
  const change = ((current - previous) / previous) * 100
  return {
    value: `${change >= 0 ? '+' : ''}${change.toFixed(0)}%`,
    positive: change >= 0,
  }
}

const SUMMARY_CARDS = [
  { title: 'Page Views', key: 'page_views' as keyof Totals, icon: Eye, color: '#3B82F6' },
  { title: 'Podcast Plays', key: 'podcast_plays' as keyof Totals, icon: Headphones, color: '#EF4444' },
  { title: 'Ticker Clicks', key: 'stock_ticker_clicks' as keyof Totals, icon: TrendingUp, color: '#F59E0B' },
  { title: 'Vote Clicks', key: 'synthszr_vote_clicks' as keyof Totals, icon: MousePointerClick, color: '#8B5CF6' },
]

export default function StatisticsPage() {
  const router = useRouter()
  const [period, setPeriod] = useState<Period>('7d')
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [podigee, setPodigee] = useState<PodigeeStats | null>(null)
  const [podigeeLoading, setPodigeeLoading] = useState(true)
  const [youtube, setYoutube] = useState<YouTubeStats | null>(null)
  const [youtubeLoading, setYoutubeLoading] = useState(true)
  const [domains, setDomains] = useState<{ domain: string; count: number; favicon: string; color: string }[]>([])
  const [domainsTotal, setDomainsTotal] = useState(0)
  const [domainsLoading, setDomainsLoading] = useState(true)
  const [languages, setLanguages] = useState<{ code: string; name: string; native_name: string | null; count: number }[]>([])
  const [languagesTotal, setLanguagesTotal] = useState(0)
  const [languagesLoading, setLanguagesLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setStats(null)
    fetch(`/api/admin/analytics/stats?period=${period}`)
      .then(res => res.json())
      .then(data => {
        setStats(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [period])

  useEffect(() => {
    setPodigeeLoading(true)
    setPodigee(null)
    fetch(`/api/admin/podigee-analytics?period=${period}`)
      .then(res => res.json())
      .then(data => {
        setPodigee(data.error ? null : data)
        setPodigeeLoading(false)
      })
      .catch(() => setPodigeeLoading(false))
  }, [period])

  useEffect(() => {
    setDomainsLoading(true)
    fetch('/api/admin/stats/subscriber-domains')
      .then(res => res.json())
      .then(data => {
        setDomains(data.domains || [])
        setDomainsTotal(data.total || 0)
        setDomainsLoading(false)
      })
      .catch(() => setDomainsLoading(false))
  }, [])

  useEffect(() => {
    setLanguagesLoading(true)
    fetch('/api/admin/stats/subscriber-languages')
      .then(res => res.json())
      .then(data => {
        setLanguages(data.languages || [])
        setLanguagesTotal(data.total || 0)
        setLanguagesLoading(false)
      })
      .catch(() => setLanguagesLoading(false))
  }, [])

  useEffect(() => {
    setYoutubeLoading(true)
    setYoutube(null)
    fetch(`/api/admin/youtube-analytics?period=${period}`)
      .then(res => res.json())
      .then(data => {
        setYoutube(data.error ? null : data)
        setYoutubeLoading(false)
      })
      .catch(() => setYoutubeLoading(false))
  }, [period])

  const granularity = PERIOD_GRANULARITY[period]

  const chartData = (stats?.events || []).map(e => ({
    ...e,
    label: formatDateLabel(e.date, granularity),
  }))

  const subscriberData = (stats?.subscribers.period_data || []).map(s => {
    const byLang = s.byLanguage ?? {}
    const flat: Record<string, number> = {}
    for (const [code, count] of Object.entries(byLang)) flat[`new_${code}`] = count
    return {
      ...s,
      ...flat,
      label: formatDateLabel(s.date, granularity),
    }
  })
  const activeSubLanguages = stats?.subscribers.active_languages ?? []
  const langPalette = ['#10B981', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#EF4444']

  // Map bucket date → web podcast plays for merging into Podigee chart
  const podcastPlaysMap = new Map<string, number>()
  for (const e of stats?.events || []) {
    podcastPlaysMap.set(e.date, e.podcast_plays)
  }
  const webPlaysTotal = stats?.totals.podcast_plays ?? 0

  // Map date → YouTube views for merging into podcast chart
  const youtubeViewsMap = new Map<string, number>()
  for (const d of youtube?.days || []) {
    youtubeViewsMap.set(d.date, d.views)
  }
  const youtubeViewsTotal = youtube?.totals.views ?? 0

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono">Statistics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date().toLocaleDateString('de-DE', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        {stats && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>
              <strong className="text-foreground font-mono">
                {stats.subscribers.current_active.toLocaleString('de-DE')}
              </strong>{' '}
              aktive Abonnenten
            </span>
          </div>
        )}
      </div>

      {/* Period Tabs */}
      <Tabs value={period} onValueChange={v => setPeriod(v as Period)}>
        <TabsList>
          <TabsTrigger value="7d">7 Tage</TabsTrigger>
          <TabsTrigger value="30d">1 Monat</TabsTrigger>
          <TabsTrigger value="90d">3 Monate</TabsTrigger>
          <TabsTrigger value="1y">1 Jahr</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {SUMMARY_CARDS.map(card => {
              const value = stats?.totals[card.key] ?? 0
              const prevValue = stats?.previous_totals[card.key] ?? 0
              const change = formatChange(value, prevValue)
              return (
                <Card key={card.key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <card.icon className="h-4 w-4" style={{ color: card.color }} />
                      {card.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold font-mono">
                      {value.toLocaleString('de-DE')}
                    </div>
                    {change ? (
                      <p className={`text-xs mt-1 ${change.positive ? 'text-green-500' : 'text-red-500'}`}>
                        {change.value} vs. Vorperiode
                      </p>
                    ) : (
                      <p className="text-xs mt-1 text-muted-foreground">Kein Vergleich</p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Line Chart: Page Views */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Page Views</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="page_views"
                    name="Page Views"
                    stroke="#3B82F6"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Line Chart: Clicks (separate scale) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Ticker & Vote Clicks</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="stock_ticker_clicks"
                    name="Ticker Clicks"
                    stroke="#F59E0B"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="synthszr_vote_clicks"
                    name="Vote Clicks"
                    stroke="#8B5CF6"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Podcast & YouTube */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Headphones className="h-4 w-4" style={{ color: '#EF4444' }} />
                Podcast & YouTube
              </CardTitle>
            </CardHeader>
            <CardContent>
              {podigeeLoading && youtubeLoading ? (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !podigee && !youtube ? (
                <p className="text-sm text-muted-foreground">Keine Daten verfügbar</p>
              ) : (
                <div className="space-y-4">
                  {/* Summary numbers */}
                  <div className="grid grid-cols-5 gap-4">
                    <div className="text-center">
                      <p className="text-3xl font-bold font-mono" style={{ color: '#9CA3AF' }}>
                        {((podigee?.totals.apple ?? 0) + (podigee?.totals.spotify ?? 0) + webPlaysTotal + youtubeViewsTotal).toLocaleString('de-DE')}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Gesamt</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold font-mono" style={{ color: '#A855F7' }}>
                        {(podigee?.totals.apple ?? 0).toLocaleString('de-DE')}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Apple</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold font-mono" style={{ color: '#22C55E' }}>
                        {(podigee?.totals.spotify ?? 0).toLocaleString('de-DE')}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Spotify</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold font-mono" style={{ color: '#EF4444' }}>
                        {webPlaysTotal.toLocaleString('de-DE')}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Web</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold font-mono" style={{ color: '#FF0000' }}>
                        {youtubeViewsTotal.toLocaleString('de-DE')}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">YouTube</p>
                    </div>
                  </div>
                  {/* Trend chart */}
                  {podigee && (
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart
                        data={podigee.days.map(d => {
                          const bucket = getDateBucket(d.date, granularity)
                          const web = podcastPlaysMap.get(bucket) || 0
                          const yt = youtubeViewsMap.get(d.date) || 0
                          return {
                            ...d,
                            label: new Date(d.date).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' }),
                            web_plays: web,
                            youtube_views: yt,
                            total_all: d.apple + d.spotify + web + yt,
                          }
                        })}
                        margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="total_all" name="Gesamt" stroke="#9CA3AF" strokeDasharray="5 5" dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="apple" name="Apple" stroke="#A855F7" dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="spotify" name="Spotify" stroke="#22C55E" dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="web_plays" name="Web" stroke="#EF4444" dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="youtube_views" name="YouTube" stroke="#FF0000" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Newsletter Subscribers */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Newsletter-Abonnenten</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Language breakdown */}
              {!languagesLoading && languagesTotal > 0 && (() => {
                const palette = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316']
                const withColor = languages.map((l, i) => ({ ...l, color: palette[i % palette.length] }))
                const flagFor = (code: string) => {
                  const map: Record<string, string> = {
                    de: '🇩🇪', en: '🇬🇧', fr: '🇫🇷', es: '🇪🇸', it: '🇮🇹',
                    pt: '🇵🇹', nl: '🇳🇱', pl: '🇵🇱', cs: '🇨🇿', nds: '🏴',
                  }
                  return map[code] ?? '🌐'
                }
                return (
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground">Sprachvarianten</span>
                      <span className="text-xs font-mono text-muted-foreground">
                        {languagesTotal.toLocaleString('de-DE')} aktiv
                      </span>
                    </div>
                    <div className="flex w-full h-6 rounded-md overflow-hidden border">
                      {withColor.filter(l => l.count > 0).map(l => (
                        <div
                          key={l.code}
                          style={{
                            width: `${(l.count / languagesTotal) * 100}%`,
                            backgroundColor: l.color,
                          }}
                          title={`${l.native_name ?? l.name}: ${l.count.toLocaleString('de-DE')}`}
                        />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                      {withColor.filter(l => l.count > 0).map(l => (
                        <div key={l.code} className="flex items-center gap-1.5 text-xs">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-sm"
                            style={{ backgroundColor: l.color }}
                          />
                          <span className="text-muted-foreground">{flagFor(l.code)}</span>
                          <span className="font-medium">{l.native_name ?? l.name}</span>
                          <span className="font-mono text-muted-foreground">
                            {l.count.toLocaleString('de-DE')}
                            {' '}
                            ({languagesTotal > 0 ? ((l.count / languagesTotal) * 100).toFixed(1) : '0'}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {subscriberData.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                  Keine Daten vorhanden
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={subscriberData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    {activeSubLanguages.length > 0 ? (
                      activeSubLanguages.map((lang, i) => (
                        <Bar
                          key={lang.code}
                          dataKey={`new_${lang.code}`}
                          name={`Zugänge ${(lang.native_name ?? lang.name)}`}
                          stackId="new"
                          fill={langPalette[i % langPalette.length]}
                          opacity={0.85}
                        />
                      ))
                    ) : (
                      <Bar dataKey="new" name="Zugänge" fill="#10B981" opacity={0.8} />
                    )}
                    <Bar dataKey="churned" name="Abgänge" fill="#EF4444" opacity={0.8} />
                    <Line
                      type="monotone"
                      dataKey="total"
                      name="Aktive Subscriber"
                      stroke="#3B82F6"
                      dot={false}
                      strokeWidth={2}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Top 20 Subscriber Domains */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Top 20 E-Mail-Domains
                {!domainsLoading && domainsTotal > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({domainsTotal.toLocaleString('de-DE')} aktive Abonnenten)
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {domainsLoading ? (
                <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Lade Domains…
                </div>
              ) : domains.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                  Keine Daten vorhanden
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(300, domains.length * 28)}>
                  <BarChart
                    data={domains}
                    layout="vertical"
                    margin={{ top: 5, right: 56, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="domain"
                      tick={{ fontSize: 11 }}
                      width={160}
                      interval={0}
                    />
                    <Tooltip
                      formatter={(value: number) => [value.toLocaleString('de-DE'), 'Abonnenten']}
                    />
                    <Bar
                      dataKey="count"
                      stroke="#000"
                      strokeWidth={0.5}
                      cursor="pointer"
                      onClick={(data: { domain?: string }) => {
                        if (data?.domain) {
                          router.push(`/admin/subscribers?search=${encodeURIComponent('@' + data.domain)}`)
                        }
                      }}
                    >
                      {domains.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                      <LabelList
                        dataKey="count"
                        position="right"
                        content={(props: {
                          x?: string | number
                          y?: string | number
                          width?: string | number
                          height?: string | number
                          value?: string | number
                          index?: number
                        }) => {
                          const { x, y, width, height, value, index } = props
                          if (
                            x === undefined || y === undefined ||
                            width === undefined || height === undefined ||
                            index === undefined
                          ) return null
                          const nx = Number(x), ny = Number(y), nw = Number(width), nh = Number(height)
                          const favicon = domains[index]?.favicon
                          const iconSize = Math.min(20, nh - 2)
                          const iconX = nx + nw + 6
                          const iconY = ny + (nh - iconSize) / 2
                          return (
                            <g>
                              {favicon && (
                                <image
                                  href={favicon}
                                  x={iconX}
                                  y={iconY}
                                  width={iconSize}
                                  height={iconSize}
                                  preserveAspectRatio="xMidYMid meet"
                                />
                              )}
                              <text
                                x={iconX + iconSize + 6}
                                y={ny + nh / 2}
                                dominantBaseline="middle"
                                fontSize={11}
                                fill="currentColor"
                              >
                                {typeof value === 'number' ? value.toLocaleString('de-DE') : value}
                              </text>
                            </g>
                          )
                        }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
