import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createHash } from 'crypto'

const VALID_EVENT_TYPES = ['page_view', 'stock_ticker_click', 'synthszr_vote_click', 'podcast_play']

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { eventType, path, company, locale } = body

    if (!eventType || !VALID_EVENT_TYPES.includes(eventType)) {
      return NextResponse.json({ tracked: false })
    }

    // Build anonymous session hash from IP + User-Agent
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'
    const userAgent = request.headers.get('user-agent') || ''
    const sessionHash = createHash('sha256').update(`${ip}:${userAgent}`).digest('hex')

    const supabase = createAdminClient()

    await supabase.from('analytics_events').insert({
      event_type: eventType,
      path: path?.slice(0, 500) || null,
      company: company?.slice(0, 200) || null,
      session_hash: sessionHash,
      locale: locale || 'de',
    })

    return NextResponse.json({ tracked: true })
  } catch {
    // Tracking should never block UX — silently return OK
    return NextResponse.json({ tracked: false })
  }
}
