import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getResend, FROM_EMAIL, BASE_URL } from '@/lib/resend/client'
import { ConfirmationEmail, getConfirmationSubject } from '@/lib/resend/templates/confirmation'
import { render } from '@react-email/components'
import { logIfUnexpected } from '@/lib/supabase/error-handling'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { requireValidOrigin } from '@/lib/security/origin-check'
import { trackReferral, generateReferralCode } from '@/lib/referrals/service'
import { mintSubscriberToken } from '@/lib/newsletter/access-tokens'

// Newsletter rate limiter: 10 requests per hour per IP (anti-spam)
const newsletterLimiter = rateLimiters.newsletter()

const CONFIRMATION_TTL_MS = 48 * 60 * 60 * 1000

/**
 * Every request carrying a syntactically valid address gets exactly this
 * response (SEC-001). Previously an already-subscribed address answered 409
 * and a new one answered 200 with the subscriber UUID, which turned this
 * endpoint into both a membership oracle and a source of credentials: submit
 * a guessed address, learn whether it is subscribed.
 */
const ACCEPTED_RESPONSE = {
  success: true,
  message: 'If this address can be subscribed, a confirmation email has been sent.',
}

function accepted() {
  return NextResponse.json(ACCEPTED_RESPONSE, {
    status: 202,
    headers: { 'Cache-Control': 'no-store' },
  })
}

/**
 * Issue a fresh confirmation link. The raw token exists only in the mail;
 * the database sees a hash. Any earlier confirm token for this subscriber is
 * dropped first, so a resend invalidates the previous link.
 */
async function issueConfirmation(
  supabase: ReturnType<typeof createAdminClient>,
  subscriberId: string,
  email: string,
  language: string,
) {
  const confirmation = mintSubscriberToken(
    subscriberId,
    'confirm',
    new Date(Date.now() + CONFIRMATION_TTL_MS),
  )

  await supabase
    .from('subscriber_action_tokens')
    .delete()
    .eq('subscriber_id', subscriberId)
    .eq('purpose', 'confirm')

  const { error } = await supabase.from('subscriber_action_tokens').insert(confirmation.row)
  if (error) {
    console.error('Subscribe token insert error:', error)
    return
  }

  await sendConfirmationEmail(email, confirmation.rawToken, language)
}

export async function POST(request: NextRequest) {
  try {
    // CSRF protection: verify request comes from our domain
    const originError = requireValidOrigin(request)
    if (originError) return originError

    // Rate limit check - 10 requests per hour per IP to prevent spam
    const clientIP = getClientIP(request)
    const rateLimitResult = await checkRateLimit(`newsletter:${clientIP}`, newsletterLimiter ?? undefined)

    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult)
    }
    const body = await request.json()
    const { email, name, language = 'en', ref } = body
    const refCode = typeof ref === 'string' ? ref.trim().slice(0, 32) : ''

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email address required' },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Check if email already exists
    const { data: existing, error: existingError } = await supabase
      .from('subscribers')
      .select('id, status')
      .eq('email', email.toLowerCase())
      .single()

    logIfUnexpected('newsletter/subscribe', existingError)

    if (existing) {
      // Already subscribed: do nothing at all, and say exactly what we say to
      // everyone else. No mail either - resending a confirmation to a
      // confirmed address would let a third party spam that inbox.
      if (existing.status === 'active') {
        return accepted()
      }

      // Reactivate if unsubscribed
      if (existing.status === 'unsubscribed') {
        await supabase
          .from('subscribers')
          .update({
            status: 'pending',
            confirmation_sent_at: new Date().toISOString(),
            unsubscribed_at: null,
            updated_at: new Date().toISOString(),
            preferences: { language },
          })
          .eq('id', existing.id)

        await issueConfirmation(supabase, existing.id, email, language)
        return accepted()
      }

      // Resend confirmation if pending
      if (existing.status === 'pending') {
        await supabase
          .from('subscribers')
          .update({
            confirmation_sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)

        await issueConfirmation(supabase, existing.id, email, language)
        return accepted()
      }
    }

    // Create new subscriber
    const { data: newSubscriber, error: insertError } = await supabase
      .from('subscribers')
      .insert({
        email: email.toLowerCase(),
        name: name || null,
        status: 'pending',
        confirmation_sent_at: new Date().toISOString(),
        preferences: { language },
        referral_code: generateReferralCode(),
      })
      .select('id')
      .single()

    if (insertError || !newSubscriber?.id) {
      console.error('Subscribe insert error:', insertError)
      return NextResponse.json(
        { error: 'Error saving subscription' },
        { status: 500 }
      )
    }

    // Empfehlung verbuchen (pending bis Opt-In); ignoriert unbekannten Code/Self-Referral.
    if (refCode) {
      await trackReferral(refCode, email, newSubscriber.id)
    }

    await issueConfirmation(supabase, newSubscriber.id, email, language)

    // The new subscriber's id stays server-side.
    return accepted()
  } catch (error) {
    console.error('Subscribe error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function sendConfirmationEmail(email: string, token: string, language: string = 'en') {
  const confirmationUrl = `${BASE_URL}/api/newsletter/confirm?token=${token}`

  const html = await render(ConfirmationEmail({ confirmationUrl, locale: language }))
  const subject = getConfirmationSubject(language)

  await getResend().emails.send({
    from: FROM_EMAIL,
    to: email,
    subject,
    html,
  })
}
