import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

type Period = '7d' | '30d' | '90d' | '1y'

const PERIOD_DAYS: Record<Period, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
}

function toDateStr(date: Date): string {
  return date.toISOString().split('T')[0]
}

export interface PodigeeDay {
  date: string
  total: number
  apple: number
  spotify: number
}

export interface PodigeeStats {
  period: Period
  days: PodigeeDay[]
  totals: { total: number; apple: number; spotify: number }
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const apiKey = process.env.PODIGEE_API_KEY
  const podcastId = process.env.PODIGEE_PODCAST_ID

  if (!apiKey || !podcastId) {
    return NextResponse.json({ error: 'Podigee nicht konfiguriert' }, { status: 500 })
  }

  const { searchParams } = new URL(request.url)
  const period = (searchParams.get('period') || '7d') as Period
  const days = PERIOD_DAYS[period] ?? 7

  const to = new Date()
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  try {
    const url = `https://app.podigee.com/api/v1/podcasts/${podcastId}/analytics?from=${toDateStr(from)}&to=${toDateStr(to)}&granularity=day`
    const res = await fetch(url, {
      headers: { 'Token': apiKey },
      cache: 'no-store',
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[Podigee Analytics] API error:', res.status, err)
      return NextResponse.json({ error: `Podigee API Fehler (${res.status})` }, { status: 502 })
    }

    const data = await res.json()
    const objects = (data.objects ?? []) as Array<{
      downloaded_on: string
      downloads: { complete?: number }
      clients: Record<string, number>
    }>

    const resultDays: PodigeeDay[] = objects.map(obj => ({
      date: obj.downloaded_on.split('T')[0],
      total: obj.downloads?.complete ?? 0,
      apple: obj.clients?.['Apple Podcasts'] ?? 0,
      spotify: obj.clients?.['Spotify'] ?? 0,
    }))

    const totals = resultDays.reduce(
      (acc, d) => ({
        total: acc.total + d.total,
        apple: acc.apple + d.apple,
        spotify: acc.spotify + d.spotify,
      }),
      { total: 0, apple: 0, spotify: 0 }
    )

    return NextResponse.json({ period, days: resultDays, totals } satisfies PodigeeStats)
  } catch (error) {
    console.error('[Podigee Analytics] Error:', error)
    return NextResponse.json({ error: 'Interner Fehler' }, { status: 500 })
  }
}
