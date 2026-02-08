import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/session'
import { refreshExpiringStockRatings, getCacheStatus } from '@/lib/stock-synthszr/refresh-cache'

export const maxDuration = 300 // 5 minutes — each OpenAI call takes ~30s

/**
 * GET /api/admin/refresh-stock-ratings
 * Returns stock_synthszr_cache status (total, expired, expiring soon).
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request)
  if (authError) return authError

  try {
    const status = await getCacheStatus()
    return NextResponse.json({ ok: true, ...status })
  } catch (error) {
    console.error('[refresh-stock-ratings] Status error:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/refresh-stock-ratings
 * Manually trigger refresh of expired/expiring stock_synthszr_cache entries.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request)
  if (authError) return authError

  try {
    const result = await refreshExpiringStockRatings()

    return NextResponse.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    console.error('[refresh-stock-ratings] Error:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
