import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createHash } from 'crypto'

const VALID_EVENT_TYPES = ['page_view', 'stock_ticker_click', 'synthszr_vote_click', 'synthszr_analysis_click', 'podcast_play']

export async function POST(request: NextRequest) {
  try {
    // Robust body parsing: sendBeacon with Blob may arrive with varying Content-Type
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      const text = await request.text()
      body = JSON.parse(text)
    }

    const { eventType, path, company, locale } = body as {
      eventType?: string
      path?: string
      company?: string
      locale?: string
    }

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

    const { error } = await supabase.from('analytics_events').insert({
      event_type: eventType,
      path: typeof path === 'string' ? path.slice(0, 500) : null,
      company: typeof company === 'string' ? company.slice(0, 200) : null,
      session_hash: sessionHash,
      locale: (locale as string) || 'de',
    })

    if (error) {
      console.error('[Track] Insert failed:', error.message, { eventType, path })
      return NextResponse.json({ tracked: false })
    }

    return NextResponse.json({ tracked: true })
  } catch (err) {
    console.error('[Track] Unexpected error:', err)
    return NextResponse.json({ tracked: false })
  }
}
