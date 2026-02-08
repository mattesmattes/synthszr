import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/session'
import { refreshExpiringStockRatings } from '@/lib/stock-synthszr/refresh-cache'

export const maxDuration = 300 // 5 minutes — each OpenAI call takes ~30s

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
