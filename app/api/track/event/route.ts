import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { readJsonBody, BoundedBodyError } from '@/lib/security/bounded-body'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

const MAX_BODY_BYTES = 8 * 1024

// Relaxed rate limiter: 100 requests per minute per IP (public write endpoint)
const relaxedLimiter = rateLimiters.relaxed()

const eventSchema = z.object({
  eventType: z.enum(['page_view', 'stock_ticker_click', 'synthszr_vote_click', 'synthszr_analysis_click', 'podcast_play']),
  path: z.string().max(500).optional(),
  company: z.string().max(200).optional(),
  locale: z.enum(['de', 'en', 'cs', 'nds', 'fr']).default('de'),
}).strict()

export async function POST(request: NextRequest) {
  try {
    // Rate limit first — a blocked request never parses the body or touches the DB.
    const ip = getClientIP(request)
    const rateLimit = await checkRateLimit(`track-event:${ip}`, relaxedLimiter ?? undefined)
    if (!rateLimit.success) {
      return rateLimitResponse(rateLimit)
    }

    let rawBody: unknown
    try {
      rawBody = await readJsonBody(request, MAX_BODY_BYTES)
    } catch (err) {
      if (err instanceof BoundedBodyError && err.code === 'BODY_TOO_LARGE') {
        return NextResponse.json({ tracked: false, error: 'Payload too large' }, { status: 413 })
      }
      return NextResponse.json({ tracked: false, error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = eventSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ tracked: false, error: 'Invalid event payload' }, { status: 400 })
    }

    const { eventType, path, company, locale } = parsed.data

    // Build anonymous session hash from IP + User-Agent
    const userAgent = request.headers.get('user-agent') || ''
    const sessionHash = createHash('sha256').update(`${ip}:${userAgent}`).digest('hex')

    const supabase = createAdminClient()

    const { error } = await supabase.from('analytics_events').insert({
      event_type: eventType,
      path: path ?? null,
      company: company ?? null,
      session_hash: sessionHash,
      locale,
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
