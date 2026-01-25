import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BASE_URL } from '@/lib/resend/client'
import { checkRateLimit, getClientIP, rateLimiters } from '@/lib/rate-limit'

// Standard rate limiter: 30 requests per minute per IP
const standardLimiter = rateLimiters.standard()

export async function GET(request: NextRequest) {
  // Rate limit check
  const clientIP = getClientIP(request)
  const rateLimitResult = await checkRateLimit(`unsubscribe:${clientIP}`, standardLimiter ?? undefined)

  if (!rateLimitResult.success) {
    return NextResponse.redirect(`${BASE_URL}/newsletter/unsubscribe?error=rate_limited`)
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.redirect(`${BASE_URL}/newsletter/unsubscribe?error=missing_id`)
  }

  try {
    const supabase = createAdminClient()

    // Find subscriber by ID
    const { data: subscriber, error: findError } = await supabase
      .from('subscribers')
      .select('id, status')
      .eq('id', id)
      .single()

    if (findError || !subscriber) {
      return NextResponse.redirect(`${BASE_URL}/newsletter/unsubscribe?error=not_found`)
    }

    if (subscriber.status === 'unsubscribed') {
      return NextResponse.redirect(`${BASE_URL}/newsletter/unsubscribe?status=already_unsubscribed`)
    }

    // Unsubscribe
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
      return NextResponse.redirect(`${BASE_URL}/newsletter/unsubscribe?error=update_failed`)
    }

    return NextResponse.redirect(`${BASE_URL}/newsletter/unsubscribe?status=success`)
  } catch (error) {
    console.error('Unsubscribe error:', error)
    return NextResponse.redirect(`${BASE_URL}/newsletter/unsubscribe?error=server_error`)
  }
}
