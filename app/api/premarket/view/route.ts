import { NextRequest, NextResponse } from 'next/server'
import { fetchPremarketSyntheses } from '@/lib/premarket/client'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

/**
 * GET /api/premarket/view
 *
 * Public endpoint to fetch a single premarket synthesis
 * Used by newsletter links and blog post dialogs
 * Rate-limited to prevent abuse
 *
 * Query parameters:
 * - search: Company name to search for
 * - isin: Exact ISIN filter
 */
export async function GET(request: NextRequest) {
  // Rate limit check - 30 requests per minute per IP
  const clientIP = getClientIP(request)
  const rateLimiter = rateLimiters.standard()
  const rateLimitResult = await checkRateLimit(`premarket-view:${clientIP}`, rateLimiter ?? undefined)

  if (!rateLimitResult.success) {
    return rateLimitResponse(rateLimitResult)
  }

  const { searchParams } = new URL(request.url)

  const search = searchParams.get('search') ?? undefined
  const isin = searchParams.get('isin') ?? undefined

  // Require at least one search parameter
  if (!search && !isin) {
    return NextResponse.json(
      { ok: false, error: 'Parameter "search" oder "isin" erforderlich' },
      { status: 400 }
    )
  }

  try {
    const result = await fetchPremarketSyntheses({
      search,
      isin,
      limit: 1,
      withSynthesis: true,
    })

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 })
    }

    if (!result.data || result.data.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Kein Premarket-Instrument gefunden' },
        { status: 404 }
      )
    }

    // Return only the first item
    return NextResponse.json({
      ok: true,
      data: [result.data[0]],
    })
  } catch (error) {
    console.error('[api/premarket/view] Error:', error)
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unbekannter Fehler',
      },
      { status: 500 }
    )
  }
}
