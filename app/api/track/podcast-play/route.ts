import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createHash } from 'crypto'

export async function POST(request: NextRequest) {
  try {
    const { postId, locale } = await request.json()

    if (!postId) {
      return NextResponse.json({ error: 'postId required' }, { status: 400 })
    }

    // Build anonymous session hash from IP + User-Agent
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'
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
      locale: locale || 'de',
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
