import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { readJsonBody, BoundedBodyError } from '@/lib/security/bounded-body'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

const MAX_BODY_BYTES = 8 * 1024

// Relaxed rate limiter: 100 requests per minute per IP (public write endpoint)
const relaxedLimiter = rateLimiters.relaxed()

const podcastPlaySchema = z.object({
  postId: z.string().uuid(),
  locale: z.enum(['de', 'en', 'cs', 'nds', 'fr']).default('de'),
}).strict()

export async function POST(request: NextRequest) {
  // Rate limit first — a blocked request never parses the body or touches the DB.
  const ip = getClientIP(request)
  const rateLimit = await checkRateLimit(`track-podcast-play:${ip}`, relaxedLimiter ?? undefined)
  if (!rateLimit.success) {
    return rateLimitResponse(rateLimit)
  }

  let rawBody: unknown
  try {
    rawBody = await readJsonBody(request, MAX_BODY_BYTES)
  } catch (err) {
    if (err instanceof BoundedBodyError && err.code === 'BODY_TOO_LARGE') {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = podcastPlaySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const { postId, locale } = parsed.data

  try {
    // Build anonymous session hash from IP + User-Agent
    const userAgent = request.headers.get('user-agent') || ''
    const sessionHash = createHash('sha256').update(`${ip}:${userAgent}`).digest('hex')

    const supabase = createAdminClient()

    // Dedup: max 1 play per session_hash + post_id per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { data: existing } = await supabase
      .from('podcast_plays')
      .select('id')
      .eq('post_id', postId)
      .eq('session_hash', sessionHash)
      .gte('played_at', oneHourAgo)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({ tracked: false, reason: 'duplicate' })
    }

    await supabase.from('podcast_plays').insert({
      post_id: postId,
      locale,
      user_agent: userAgent.slice(0, 500),
      referrer: request.headers.get('referer')?.slice(0, 500) || null,
      session_hash: sessionHash,
    })

    return NextResponse.json({ tracked: true })
  } catch {
    // Tracking should never block UX — silently return OK
    return NextResponse.json({ tracked: false })
  }
}
