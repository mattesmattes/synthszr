import { NextRequest, NextResponse } from 'next/server'
import { fetchPremarketSyntheses } from '@/lib/premarket/client'
import { getSession } from '@/lib/auth/session'
import { parseIntParam } from '@/lib/validation/query-params'

/**
 * GET /api/premarket
 *
 * Fetches premarket syntheses from stocks.app
 * Requires admin session for access
 *
 * Query parameters:
 * - search: Freetext search (name, issuer, symbol, ISIN)
 * - isin: Exact ISIN filter
 * - limit: Results per page (default: 50, max: 500)
 * - offset: Pagination offset
 * - withSynthesis: Only return items with AI synthesis
 */
export async function GET(request: NextRequest) {
  // Check admin session
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json(
      { ok: false, error: 'Nicht autorisiert' },
      { status: 401 }
    )
  }

  const { searchParams } = new URL(request.url)

  const search = searchParams.get('search') ?? undefined
  const isin = searchParams.get('isin') ?? undefined
  const withSynthesis = searchParams.get('withSynthesis') === 'true'

  // Parse and validate limit/offset using shared validation helper
  const limit = parseIntParam(searchParams.get('limit'), 50, 1, 500)
  const offset = parseIntParam(searchParams.get('offset'), 0, 0)

  try {
    const result = await fetchPremarketSyntheses({
      search,
      isin,
      limit,
      offset,
      withSynthesis,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[api/premarket] Error:', error)
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unbekannter Fehler',
      },
      { status: 500 }
    )
  }
}
