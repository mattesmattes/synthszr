import { NextRequest, NextResponse } from 'next/server'
import { ensureStockSynthszr } from '@/lib/stock-synthszr/warm'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

// Allow longer timeout for AI generation
export const maxDuration = 120

// Strict rate limiter for expensive AI operations (5 requests per minute per IP)
const strictLimiter = rateLimiters.strict()

export async function POST(request: NextRequest) {
  try {
    // Rate limit check - 5 requests per minute per IP for expensive AI operations
    const clientIP = getClientIP(request)
    const rateLimitResult = await checkRateLimit(`stock-synthszr:${clientIP}`, strictLimiter ?? undefined)

    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult)
    }

    let payload: Record<string, unknown>
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Ungültiges JSON im Request Body' },
        { status: 400 }
      )
    }

    const company = typeof payload?.company === 'string' ? payload.company.trim() : ''

    if (!company) {
      return NextResponse.json(
        { ok: false, error: 'Parameter "company" fehlt.' },
        { status: 400 }
      )
    }

    const force = Boolean(payload?.force)
    const currency = typeof payload?.currency === 'string' ? payload.currency : 'EUR'
    const price = typeof payload?.price === 'number' ? payload.price : null

    const { data, cached } = await ensureStockSynthszr({ company, currency, price, force })
    return NextResponse.json(cached ? { ok: true, data, cached: true } : { ok: true, data })
  } catch (error) {
    console.error('[stock-synthszr] failed', error)
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 }
    )
  }
}
