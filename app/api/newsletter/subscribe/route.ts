import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getResend, FROM_EMAIL, BASE_URL } from '@/lib/resend/client'
import { ConfirmationEmail, getConfirmationSubject } from '@/lib/resend/templates/confirmation'
import { render } from '@react-email/components'
import { logIfUnexpected } from '@/lib/supabase/error-handling'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

// Newsletter rate limiter: 10 requests per hour per IP (anti-spam)
const newsletterLimiter = rateLimiters.newsletter()

export async function POST(request: NextRequest) {
  try {
    // Rate limit check - 10 requests per hour per IP to prevent spam
    const clientIP = getClientIP(request)
    const rateLimitResult = await checkRateLimit(`newsletter:${clientIP}`, newsletterLimiter ?? undefined)

    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult)
    }
    const body = await request.json()
    const { email, name, language = 'de' } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'E-Mail-Adresse erforderlich' },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Ungültige E-Mail-Adresse' },
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
      if (existing.status === 'active') {
        return NextResponse.json(
          { error: 'Diese E-Mail ist bereits angemeldet' },
          { status: 409 }
        )
      }

      // Reactivate if unsubscribed
      if (existing.status === 'unsubscribed') {
        const confirmationToken = crypto.randomUUID()

        await supabase
          .from('subscribers')
          .update({
            status: 'pending',
            confirmation_token: confirmationToken,
            confirmation_sent_at: new Date().toISOString(),
            unsubscribed_at: null,
            updated_at: new Date().toISOString(),
            preferences: { language },
          })
          .eq('id', existing.id)

        await sendConfirmationEmail(email, confirmationToken, language)

        return NextResponse.json({
          success: true,
          message: 'Bestätigungs-E-Mail wurde erneut gesendet'
        })
      }

      // Resend confirmation if pending
      if (existing.status === 'pending') {
        const confirmationToken = crypto.randomUUID()

        await supabase
          .from('subscribers')
          .update({
            confirmation_token: confirmationToken,
            confirmation_sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)

        await sendConfirmationEmail(email, confirmationToken, language)

        return NextResponse.json({
          success: true,
          message: 'Bestätigungs-E-Mail wurde erneut gesendet'
        })
      }
    }

    // Create new subscriber
    const confirmationToken = crypto.randomUUID()

    const { error: insertError } = await supabase
      .from('subscribers')
      .insert({
        email: email.toLowerCase(),
        name: name || null,
        status: 'pending',
        confirmation_token: confirmationToken,
        confirmation_sent_at: new Date().toISOString(),
        preferences: { language },
      })

    if (insertError) {
      console.error('Subscribe insert error:', insertError)
      return NextResponse.json(
        { error: 'Fehler beim Speichern' },
        { status: 500 }
      )
    }

    // Send confirmation email
    await sendConfirmationEmail(email, confirmationToken, language)

    return NextResponse.json({
      success: true,
      message: 'Bestätigungs-E-Mail wurde gesendet'
    })
  } catch (error) {
    console.error('Subscribe error:', error)
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    )
  }
}

async function sendConfirmationEmail(email: string, token: string, language: string = 'de') {
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
