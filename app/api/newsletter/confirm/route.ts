import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BASE_URL } from '@/lib/resend/client'
import { checkRateLimit, getClientIP, rateLimiters } from '@/lib/rate-limit'
import { confirmReferral } from '@/lib/referrals/service'
import { resolveSubscriberToken } from '@/lib/newsletter/access-tokens'

// Standard rate limiter: 30 requests per minute per IP
const standardLimiter = rateLimiters.standard()

/** Confirmation outcomes are per-request state; never let a cache keep them. */
function redirect(target: string) {
  return NextResponse.redirect(target, { headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: NextRequest) {
  // Rate limit check
  const clientIP = getClientIP(request)
  const rateLimitResult = await checkRateLimit(`confirm:${clientIP}`, standardLimiter ?? undefined)

  if (!rateLimitResult.success) {
    return redirect(`${BASE_URL}/newsletter/confirm?error=rate_limited`)
  }

  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return redirect(`${BASE_URL}/newsletter/confirm?error=missing_token`)
  }

  try {
    // Single-use: resolving consumes the token, so a replayed link (mail
    // client prefetch, forwarded mail, browser history) cannot re-run the
    // activation. Only the subscriber this token was minted for is returned -
    // the request never gets to name an id itself.
    const resolved = await resolveSubscriberToken(token, 'confirm', { consume: true })
    if (!resolved) {
      return redirect(`${BASE_URL}/newsletter/confirm?error=invalid_token`)
    }

    const supabase = createAdminClient()

    const { data: subscriber, error: findError } = await supabase
      .from('subscribers')
      .select('id, status, email')
      .eq('id', resolved.subscriberId)
      .single()

    if (findError || !subscriber) {
      return redirect(`${BASE_URL}/newsletter/confirm?error=invalid_token`)
    }

    if (subscriber.status === 'active') {
      return redirect(`${BASE_URL}/newsletter/confirm?status=already_confirmed`)
    }

    // Activate subscriber
    const { error: updateError } = await supabase
      .from('subscribers')
      .update({
        status: 'active',
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriber.id)

    if (updateError) {
      console.error('Confirm update error:', updateError)
      return redirect(`${BASE_URL}/newsletter/confirm?error=update_failed`)
    }

    // Offene Empfehlung dieses Geworbenen bestätigen (+ ggf. Belohnung auslösen).
    await confirmReferral(subscriber.id, subscriber.email)

    return redirect(`${BASE_URL}/newsletter/confirm?status=success`)
  } catch (error) {
    console.error('Confirm error:', error)
    return redirect(`${BASE_URL}/newsletter/confirm?error=server_error`)
  }
}
