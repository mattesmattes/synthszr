import { NextRequest, NextResponse } from 'next/server'
import { fetchPremarketSyntheses } from '@/lib/premarket/client'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import type { PremarketItem } from '@/lib/premarket/types'

// Standard rate limiter for read operations (30 requests per minute per IP)
const standardLimiter = rateLimiters.standard()

export interface PremarketRatingResult {
  company: string
  isin: string | null
  rating: 'BUY' | 'HOLD' | 'SELL' | null
  premarketName: string | null
  instrumentName: string | null
  latestPrice: number | null
  currency: string | null
  cached: boolean
}

/**
 * Batch endpoint to get Premarket Synthszr ratings for multiple companies
 * Searches by company name and returns the synthesis rating
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limit check - 30 requests per minute per IP for read operations
    const clientIP = getClientIP(request)
    const rateLimitResult = await checkRateLimit(`premarket-batch:${clientIP}`, standardLimiter ?? undefined)

    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult)
    }

    const payload = await request.json().catch(() => ({}))
    const companies = Array.isArray(payload?.companies) ? payload.companies : []

    if (companies.length === 0) {
      return NextResponse.json({ ok: true, ratings: [] })
    }

    // Limit to prevent abuse
    if (companies.length > 20) {
      return NextResponse.json(
        { ok: false, error: 'Maximal 20 Unternehmen pro Anfrage' },
        { status: 400 }
      )
    }

    const results: PremarketRatingResult[] = []

    // Search for each company
    for (const company of companies) {
      if (typeof company !== 'string' || !company.trim()) continue

      const searchName = company.trim()

      try {
        // Search by company name - only get items with synthesis
        const response = await fetchPremarketSyntheses({
          search: searchName,
          withSynthesis: true,
          limit: 5, // Get a few matches and find best match
        })

        if (response.ok && response.data && response.data.length > 0) {
          // Find exact or best match
          const exactMatch = response.data.find(
            (item: PremarketItem) =>
              item.instrument.name?.toLowerCase() === searchName.toLowerCase() ||
              item.premarket.name.toLowerCase() === searchName.toLowerCase()
          )
          const item = exactMatch || response.data[0]

          results.push({
            company: searchName,
            isin: item.instrument.isin,
            rating: item.synthesis?.rating ?? null,
            premarketName: item.premarket.name,
            instrumentName: item.instrument.name,
            latestPrice: item.latestPrice,
            currency: item.instrument.currency,
            cached: true, // The API caches responses
          })
        } else {
          results.push({
            company: searchName,
            isin: null,
            rating: null,
            premarketName: null,
            instrumentName: null,
            latestPrice: null,
            currency: null,
            cached: false,
          })
        }
      } catch (error) {
        console.error(`[premarket/batch-ratings] Error searching ${searchName}:`, error)
        results.push({
          company: searchName,
          isin: null,
          rating: null,
          premarketName: null,
          instrumentName: null,
          latestPrice: null,
          currency: null,
          cached: false,
        })
      }
    }

    return NextResponse.json({ ok: true, ratings: results })
  } catch (error) {
    console.error('[premarket/batch-ratings] failed', error)
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    )
  }
}
