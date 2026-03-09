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

export interface YouTubeDay {
  date: string
  views: number
}

export interface YouTubeStats {
  period: Period
  days: YouTubeDay[]
  totals: { views: number; subscribers: number }
  channelTitle: string | null
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  const channelId = process.env.YOUTUBE_CHANNEL_ID

  if (!apiKey || !channelId) {
    return NextResponse.json({ error: 'YouTube nicht konfiguriert' }, { status: 500 })
  }

  const { searchParams } = new URL(request.url)
  const period = (searchParams.get('period') || '7d') as Period
  const days = PERIOD_DAYS[period] ?? 7

  try {
    // Fetch channel statistics (total subscribers + total views)
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${channelId}&key=${apiKey}`
    const channelRes = await fetch(channelUrl, { cache: 'no-store' })

    if (!channelRes.ok) {
      const err = await channelRes.text()
      console.error('[YouTube Analytics] Channel API error:', channelRes.status, err)
      return NextResponse.json({ error: `YouTube API Fehler (${channelRes.status})` }, { status: 502 })
    }

    const channelData = await channelRes.json()
    const channel = channelData.items?.[0]

    if (!channel) {
      return NextResponse.json({ error: 'YouTube-Kanal nicht gefunden' }, { status: 404 })
    }

    const channelTitle = channel.snippet?.title || null
    const totalSubscribers = parseInt(channel.statistics?.subscriberCount || '0', 10)

    // Fetch recent videos to get per-video view counts
    // YouTube Data API v3 doesn't provide daily analytics (that requires YouTube Analytics API + OAuth)
    // Instead, we fetch recent videos and their view counts as a proxy
    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads

    let videoDays: YouTubeDay[] = []
    let totalViews = 0

    if (uploadsPlaylistId) {
      // Fetch playlist items (most recent videos)
      const maxResults = Math.min(days, 50) // YouTube API max is 50
      const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}&maxResults=${maxResults}&key=${apiKey}`
      const playlistRes = await fetch(playlistUrl, { cache: 'no-store' })

      if (playlistRes.ok) {
        const playlistData = await playlistRes.json()
        const videoIds = (playlistData.items || [])
          .map((item: { contentDetails?: { videoId?: string } }) => item.contentDetails?.videoId)
          .filter(Boolean)

        if (videoIds.length > 0) {
          // Fetch video statistics
          const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds.join(',')}&key=${apiKey}`
          const videosRes = await fetch(videosUrl, { cache: 'no-store' })

          if (videosRes.ok) {
            const videosData = await videosRes.json()
            const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

            // Group views by publish date
            const viewsByDate = new Map<string, number>()

            for (const video of videosData.items || []) {
              const publishedAt = new Date(video.snippet?.publishedAt || '')
              if (publishedAt >= cutoffDate) {
                const dateKey = publishedAt.toISOString().split('T')[0]
                const views = parseInt(video.statistics?.viewCount || '0', 10)
                viewsByDate.set(dateKey, (viewsByDate.get(dateKey) || 0) + views)
                totalViews += views
              }
            }

            // Convert to sorted array
            videoDays = Array.from(viewsByDate.entries())
              .map(([date, views]) => ({ date, views }))
              .sort((a, b) => a.date.localeCompare(b.date))
          }
        }
      }
    } else {
      // Fallback: use channel-level contentDetails
      // Fetch recent videos via search
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${channelId}&type=video&order=date&publishedAfter=${cutoffDate.toISOString()}&maxResults=50&key=${apiKey}`
      const searchRes = await fetch(searchUrl, { cache: 'no-store' })

      if (searchRes.ok) {
        const searchData = await searchRes.json()
        const videoIds = (searchData.items || [])
          .map((item: { id?: { videoId?: string } }) => item.id?.videoId)
          .filter(Boolean)

        if (videoIds.length > 0) {
          const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds.join(',')}&key=${apiKey}`
          const videosRes = await fetch(videosUrl, { cache: 'no-store' })

          if (videosRes.ok) {
            const videosData = await videosRes.json()
            const viewsByDate = new Map<string, number>()

            for (const video of videosData.items || []) {
              const dateKey = new Date(video.snippet?.publishedAt || '').toISOString().split('T')[0]
              const views = parseInt(video.statistics?.viewCount || '0', 10)
              viewsByDate.set(dateKey, (viewsByDate.get(dateKey) || 0) + views)
              totalViews += views
            }

            videoDays = Array.from(viewsByDate.entries())
              .map(([date, views]) => ({ date, views }))
              .sort((a, b) => a.date.localeCompare(b.date))
          }
        }
      }
    }

    return NextResponse.json({
      period,
      days: videoDays,
      totals: { views: totalViews, subscribers: totalSubscribers },
      channelTitle,
    } satisfies YouTubeStats)
  } catch (error) {
    console.error('[YouTube Analytics] Error:', error)
    return NextResponse.json({ error: 'Interner Fehler' }, { status: 500 })
  }
}
