import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BASE_URL } from '@/lib/resend/client'
import { checkRateLimit, getClientIP, rateLimiters } from '@/lib/rate-limit'

// Standard rate limiter: 30 requests per minute per IP
const standardLimiter = rateLimiters.standard()

export async function GET(request: NextRequest) {
  // Rate limit check
  const clientIP = getClientIP(request)
  const rateLimitResult = await checkRateLimit(`confirm:${clientIP}`, standardLimiter ?? undefined)

  if (!rateLimitResult.success) {
    return NextResponse.redirect(`${BASE_URL}/newsletter/confirm?error=rate_limited`)
  }

  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(`${BASE_URL}/newsletter/confirm?error=missing_token`)
  }

  try {
    const supabase = createAdminClient()

    // Find subscriber by token
    const { data: subscriber, error: findError } = await supabase
      .from('subscribers')
      .select('id, status')
      .eq('confirmation_token', token)
      .single()

    if (findError || !subscriber) {
      return NextResponse.redirect(`${BASE_URL}/newsletter/confirm?error=invalid_token`)
    }

    if (subscriber.status === 'active') {
      return NextResponse.redirect(`${BASE_URL}/newsletter/confirm?status=already_confirmed`)
    }

    // Activate subscriber
    const { error: updateError } = await supabase
      .from('subscribers')
      .update({
        status: 'active',
        confirmed_at: new Date().toISOString(),
        confirmation_token: null, // Invalidate token after use
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriber.id)

    if (updateError) {
      console.error('Confirm update error:', updateError)
      return NextResponse.redirect(`${BASE_URL}/newsletter/confirm?error=update_failed`)
    }

    return NextResponse.redirect(`${BASE_URL}/newsletter/confirm?status=success`)
  } catch (error) {
    console.error('Confirm error:', error)
    return NextResponse.redirect(`${BASE_URL}/newsletter/confirm?error=server_error`)
  }
}
