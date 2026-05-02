import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

const PODIGEE_BASE = 'https://app.podigee.com/api/v1'

function toBerlinDateStr(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(date)
}

// Number of days between two YYYY-MM-DD strings (positive = b is later).
function dayDiff(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime()
  const db = new Date(`${b}T00:00:00Z`).getTime()
  return Math.round((db - da) / 86_400_000)
}

// Strip punctuation, lowercase, collapse whitespace — enough overlap to
// catch "Foo: The Bar" matching "Foo - The Bar" without dragging in a
// fuzzy-match library.
function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * GET /api/podcast/podigee-status?postId=X
 * Checks whether a Podigee episode already exists for the given post
 * by matching the post's created_at date against episodes' published_at date
 * (Berlin timezone, day granularity).
 */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const postId = searchParams.get('postId')
  if (!postId) {
    return NextResponse.json({ error: 'postId erforderlich' }, { status: 400 })
  }

  const apiKey = process.env.PODIGEE_API_KEY
  const podcastId = process.env.PODIGEE_PODCAST_ID
  if (!apiKey || !podcastId) {
    return NextResponse.json({ error: 'Podigee nicht konfiguriert' }, { status: 500 })
  }

  try {
    const supabase = createAdminClient()
    const { data: post, error: postError } = await supabase
      .from('generated_posts')
      .select('id, title, created_at')
      .eq('id', postId)
      .single()

    if (postError || !post) {
      return NextResponse.json({ error: 'Post nicht gefunden' }, { status: 404 })
    }

    const targetDate = toBerlinDateStr(post.created_at as string)
    const postTitleNorm = normalizeTitle((post.title as string) || '')

    const res = await fetch(
      `${PODIGEE_BASE}/podcasts/${podcastId}/episodes?per_page=30`,
      { headers: { Token: apiKey }, cache: 'no-store' }
    )

    if (!res.ok) {
      console.error('[Podigee Status] API error:', res.status, await res.text().catch(() => ''))
      return NextResponse.json({ error: `Podigee API Fehler (${res.status})` }, { status: 502 })
    }

    const data = await res.json()
    const episodes = (Array.isArray(data) ? data : (data.episodes ?? data.objects ?? [])) as Array<{
      id: number
      title?: string
      published_at?: string | null
      url?: string | null
      permalink?: string | null
    }>

    // Match strategy: prefer same-day, then ±1 day, then a title prefix
    // overlap within ±3 days. Real-world Podigee uploads can publish a
    // day before/after the post, especially when the post moves between
    // draft/published — strict same-day matching false-negatives those.
    type Episode = typeof episodes[number]
    let match: Episode | undefined
    let matchReason: 'same-day' | 'plus-minus-1' | 'title-fuzzy' | undefined

    // Pass 1: exact day
    match = episodes.find(ep => ep.published_at && toBerlinDateStr(ep.published_at) === targetDate)
    if (match) matchReason = 'same-day'

    // Pass 2: ±1 day
    if (!match) {
      match = episodes.find(ep => {
        if (!ep.published_at) return false
        return Math.abs(dayDiff(targetDate, toBerlinDateStr(ep.published_at))) <= 1
      })
      if (match) matchReason = 'plus-minus-1'
    }

    // Pass 3: title overlap within ±3 days. Prefix overlap of at least 6
    // chars catches cases like the Podigee episode title being slightly
    // re-worded from the post title.
    if (!match && postTitleNorm.length >= 6) {
      const prefix = postTitleNorm.slice(0, Math.min(20, postTitleNorm.length))
      match = episodes.find(ep => {
        if (!ep.published_at || !ep.title) return false
        const within = Math.abs(dayDiff(targetDate, toBerlinDateStr(ep.published_at))) <= 3
        if (!within) return false
        const epTitleNorm = normalizeTitle(ep.title)
        return epTitleNorm.includes(prefix.slice(0, 12)) || prefix.includes(epTitleNorm.slice(0, 12))
      })
      if (match) matchReason = 'title-fuzzy'
    }

    if (!match) {
      // Surface the most recent few episodes so the UI / debug pane can show
      // *what* Podigee actually has. Without this, "noch nicht veröffentlicht"
      // is unfalsifiable from the admin's side.
      const recent = episodes.slice(0, 5).map(ep => ({
        id: ep.id,
        title: ep.title ?? null,
        publishedAt: ep.published_at ?? null,
        publishedDate: ep.published_at ? toBerlinDateStr(ep.published_at) : null,
      }))
      return NextResponse.json({
        published: false,
        targetDate,
        recentEpisodes: recent,
      })
    }

    const episodeUrl =
      match.url ||
      match.permalink ||
      `https://app.podigee.com/dashboard/podcasts/${podcastId}/episodes/${match.id}/edit`

    return NextResponse.json({
      published: true,
      episodeId: match.id,
      episodeUrl,
      episodeTitle: match.title ?? null,
      publishedAt: match.published_at ?? null,
      matchReason,
    })
  } catch (error) {
    console.error('[Podigee Status] Error:', error)
    return NextResponse.json({ error: 'Interner Fehler' }, { status: 500 })
  }
}
