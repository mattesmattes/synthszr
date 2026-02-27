'use client'

import { useState, useEffect } from 'react'
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
    period_data: SubscriberEntry[]
    current_active: number
  }
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
  const [period, setPeriod] = useState<Period>('7d')
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [podigee, setPodigee] = useState<PodigeeStats | null>(null)
  const [podigeeLoading, setPodigeeLoading] = useState(true)

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

  const granularity = PERIOD_GRANULARITY[period]

  const chartData = (stats?.events || []).map(e => ({
    ...e,
    label: formatDateLabel(e.date, granularity),
  }))

  const subscriberData = (stats?.subscribers.period_data || []).map(s => ({
    ...s,
    label: formatDateLabel(s.date, granularity),
  }))

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

          {/* Line Chart: Events over time */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Verlauf</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="page_views"
                    name="Page Views"
                    stroke="#3B82F6"
                    dot={false}
                    strokeWidth={2}
                  />
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

          {/* Podigee Podcast Downloads */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Headphones className="h-4 w-4" style={{ color: '#EF4444' }} />
                Podcast Downloads (Podigee)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {podigeeLoading ? (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !podigee ? (
                <p className="text-sm text-muted-foreground">Keine Podigee-Daten verfügbar</p>
              ) : (
                <div className="space-y-4">
                  {/* Summary numbers */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <p className="text-3xl font-bold font-mono" style={{ color: '#EF4444' }}>
                        {podigee.totals.total.toLocaleString('de-DE')}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Gesamt</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold font-mono" style={{ color: '#A855F7' }}>
                        {podigee.totals.apple.toLocaleString('de-DE')}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Apple Podcasts</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold font-mono" style={{ color: '#22C55E' }}>
                        {podigee.totals.spotify.toLocaleString('de-DE')}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Spotify</p>
                    </div>
                  </div>
                  {/* Trend chart */}
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart
                      data={podigee.days.map(d => ({
                        ...d,
                        label: new Date(d.date).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' }),
                      }))}
                      margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="total" name="Gesamt" stroke="#EF4444" dot={false} strokeWidth={2} />
                      <Line type="monotone" dataKey="apple" name="Apple Podcasts" stroke="#A855F7" dot={false} strokeWidth={2} />
                      <Line type="monotone" dataKey="spotify" name="Spotify" stroke="#22C55E" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
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
                    <Bar dataKey="new" name="Zugänge" fill="#10B981" opacity={0.8} />
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
        </>
      )}
    </div>
  )
}
