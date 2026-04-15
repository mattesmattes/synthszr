import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BASE_URL } from '@/lib/resend/client'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { requireValidOrigin } from '@/lib/security/origin-check'

const standardLimiter = rateLimiters.standard()

/**
 * GET /api/newsletter/unsubscribe?id=<uuid>
 *
 * Previously GET performed the actual unsubscribe, which caused automatic
 * unsubscribes whenever Outlook Safe Links, Microsoft ATP, or other mail
 * security gateways prefetched the link during inbox scanning.
 *
 * GET now just redirects to the confirmation landing page — no side-effect.
 * The landing page shows a single "Yes, unsubscribe me" button that POSTs
 * back to this route.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const target = id
    ? `${BASE_URL}/newsletter/unsubscribe?confirm=1&id=${encodeURIComponent(id)}`
    : `${BASE_URL}/newsletter/unsubscribe?error=missing_id`
  return NextResponse.redirect(target, 302)
}

/**
 * POST /api/newsletter/unsubscribe
 * Body: { id: string }
 *
 * Performs the actual unsubscribe. Protected by Origin check to block
 * cross-site POSTs. Rate-limited per IP.
 */
export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request)
  if (originError) return originError

  const clientIP = getClientIP(request)
  const rateLimitResult = await checkRateLimit(`unsubscribe:${clientIP}`, standardLimiter ?? undefined)
  if (!rateLimitResult.success) return rateLimitResponse(rateLimitResult)

  try {
    const body = await request.json().catch(() => ({}))
    const id = (body.id ?? '').toString().trim()
    if (!id) return NextResponse.json({ error: 'id erforderlich' }, { status: 400 })

    const supabase = createAdminClient()

    const { data: subscriber, error: findError } = await supabase
      .from('subscribers')
      .select('id, status')
      .eq('id', id)
      .maybeSingle()

    if (findError || !subscriber) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    if (subscriber.status === 'unsubscribed') {
      return NextResponse.json({ status: 'already_unsubscribed' })
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
      return NextResponse.json({ error: 'update_failed' }, { status: 500 })
    }

    return NextResponse.json({ status: 'success' })
  } catch (error) {
    console.error('Unsubscribe error:', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
