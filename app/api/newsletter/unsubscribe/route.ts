import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { requireValidOrigin } from '@/lib/security/origin-check'
import { resolveSubscriberToken } from '@/lib/newsletter/access-tokens'
import { readJsonBody, BoundedBodyError } from '@/lib/security/bounded-body'

const standardLimiter = rateLimiters.standard()

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * POST /api/newsletter/unsubscribe
 * Body: { token: string }
 *
 * There is no GET handler. Mail security gateways (Outlook Safe Links,
 * Microsoft ATP) prefetch links while scanning an inbox, which previously
 * unsubscribed people who never clicked anything. The mail link now points
 * straight at the confirmation page, which POSTs back here.
 *
 * The credential is a purpose-scoped token rather than `subscribers.id`
 * (SEC-001): the id could be replayed forever and worked for every other
 * action too. The token is consumed on success, so one link unsubscribes at
 * most once.
 */
export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request)
  if (originError) return originError

  const clientIP = getClientIP(request)
  const rateLimitResult = await checkRateLimit(`unsubscribe:${clientIP}`, standardLimiter ?? undefined)
  if (!rateLimitResult.success) return rateLimitResponse(rateLimitResult)

  try {
    let rawBody: unknown
    try {
      rawBody = await readJsonBody(request, 8 * 1024)
    } catch (err) {
      if (err instanceof BoundedBodyError) {
        return NextResponse.json(
          { error: err.code === 'BODY_TOO_LARGE' ? 'payload_too_large' : 'invalid_body' },
          { status: err.code === 'BODY_TOO_LARGE' ? 413 : 400, headers: NO_STORE }
        )
      }
      throw err
    }
    const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    if (!token) {
      return NextResponse.json({ error: 'token erforderlich' }, { status: 400, headers: NO_STORE })
    }

    const resolved = await resolveSubscriberToken(token, 'unsubscribe', { consume: true })
    if (!resolved) {
      return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
    }

    const supabase = createAdminClient()

    const { data: subscriber, error: findError } = await supabase
      .from('subscribers')
      .select('id, status')
      .eq('id', resolved.subscriberId)
      .maybeSingle()

    if (findError || !subscriber) {
      return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
    }

    if (subscriber.status === 'unsubscribed') {
      return NextResponse.json({ status: 'already_unsubscribed' }, { headers: NO_STORE })
    }

    const { error: updateError } = await supabase
      .from('subscribers')
      .update({
        status: 'unsubscribed',
        unsubscribed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriber.id)

    if (updateError) {
      console.error('Unsubscribe update error:', updateError)
      return NextResponse.json({ error: 'update_failed' }, { status: 500, headers: NO_STORE })
    }

    // Revoke all remaining action tokens (comment, preferences, referral) for this subscriber
    await supabase
      .from('subscriber_action_tokens')
      .update({ consumed_at: new Date().toISOString() })
      .eq('subscriber_id', subscriber.id)
      .is('consumed_at', null)

    const res = NextResponse.json({ status: 'success' }, { headers: NO_STORE })
    res.cookies.delete('synthszr_reader')
    return res
  } catch (error) {
    console.error('Unsubscribe error:', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers: NO_STORE })
  }
}
