import { NextRequest, NextResponse } from 'next/server'
import { createAnonClient } from '@/lib/supabase/admin'
import type { StockSynthszrResult } from '@/lib/stock-synthszr/types'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { MAX_BATCH_SIZE } from '@/lib/data/companies'

// Standard rate limiter for read operations (30 requests per minute per IP)
const standardLimiter = rateLimiters.standard()

interface CacheRow {
  company: string
  currency: string
  data: StockSynthszrResult
  created_at: string
}

export interface StockRatingResult {
  company: string
  rating: 'BUY' | 'HOLD' | 'SELL' | null
  cached: boolean
}

/**
 * Batch endpoint to get cached Stock-Synthszr ratings for multiple companies
 * Returns only the final_recommendation.rating for each company
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limit check - 30 requests per minute per IP for read operations
    const clientIP = getClientIP(request)
    const rateLimitResult = await checkRateLimit(`batch-ratings:${clientIP}`, standardLimiter ?? undefined)

    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult)
    }

    const payload = await request.json().catch(() => ({}))
    const companies = Array.isArray(payload?.companies) ? payload.companies : []

    if (companies.length === 0) {
      return NextResponse.json({ ok: true, ratings: [] })
    }

    // Limit to prevent abuse
    if (companies.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { ok: false, error: `Maximal ${MAX_BATCH_SIZE} Unternehmen pro Anfrage` },
        { status: 400 }
      )
    }

    const supabase = createAnonClient()
    const results: StockRatingResult[] = []

    // Query cache for each company (any currency - rating is the same)
    for (const company of companies) {
      if (typeof company !== 'string' || !company.trim()) continue

      const { data: cached } = await supabase
        .from('stock_synthszr_cache')
        .select('company, data, created_at')
        .ilike('company', company.trim())
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single<CacheRow>()

      if (cached?.data?.final_recommendation?.rating) {
        results.push({
          company: company.trim(),
          rating: cached.data.final_recommendation.rating,
          cached: true,
        })
      } else {
        results.push({
          company: company.trim(),
          rating: null,
          cached: false,
        })
      }
    }

    return NextResponse.json({ ok: true, ratings: results })
  } catch (error) {
    console.error('[stock-synthszr/batch-ratings] failed', error)
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    )
  }
}
