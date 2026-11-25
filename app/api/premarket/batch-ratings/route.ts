import { NextRequest, NextResponse } from 'next/server'
import { fetchPremarketSyntheses } from '@/lib/premarket/client'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { readJsonBody, BoundedBodyError } from '@/lib/security/bounded-body'
import type { PremarketItem } from '@/lib/premarket/types'
import { MAX_BATCH_SIZE } from '@/lib/constants/thresholds'

const MAX_COMPANY_NAME_LEN = 100
const BATCH_CONCURRENCY = 5

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
  keyTakeaways?: string[]
  rationale?: string | null
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

    let payload: Record<string, unknown>
    try {
      const parsed = await readJsonBody(request, 16 * 1024)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json(
          { ok: false, error: 'Ungültiges JSON im Request Body' },
          { status: 400 }
        )
      }
      payload = parsed as Record<string, unknown>
    } catch (err) {
      if (err instanceof BoundedBodyError && err.code === 'BODY_TOO_LARGE') {
        return NextResponse.json(
          { ok: false, error: 'Request Body zu groß' },
          { status: 413 }
        )
      }
      return NextResponse.json(
        { ok: false, error: 'Ungültiges JSON im Request Body' },
        { status: 400 }
      )
    }

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

    const validCompanies = companies
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      .map((c) => c.trim().slice(0, MAX_COMPANY_NAME_LEN))

    const results: PremarketRatingResult[] = []

    // Bounded concurrent fan-out to avoid 20×10s sequential worker blocking
    for (let i = 0; i < validCompanies.length; i += BATCH_CONCURRENCY) {
      const chunk = validCompanies.slice(i, i + BATCH_CONCURRENCY)
      const chunkResults = await Promise.all(
        chunk.map(async (searchName): Promise<PremarketRatingResult> => {
          try {
            const response = await fetchPremarketSyntheses({
              search: searchName,
              withSynthesis: true,
              limit: 5,
            })

            if (response.ok && response.data && response.data.length > 0) {
              const exactMatch = response.data.find(
                (item: PremarketItem) =>
                  item.instrument.name?.toLowerCase() === searchName.toLowerCase() ||
                  item.premarket.name.toLowerCase() === searchName.toLowerCase()
              )
              const item = exactMatch || response.data[0]

              return {
                company: searchName,
                isin: item.instrument.isin,
                rating: item.synthesis?.rating ?? null,
                premarketName: item.premarket.name,
                instrumentName: item.instrument.name,
                latestPrice: item.latestPrice,
                currency: item.instrument.currency,
                cached: true,
                keyTakeaways: item.synthesis?.keyTakeaways?.slice(0, 3),
                rationale: item.synthesis?.rationale,
              }
            }
            return {
              company: searchName,
              isin: null,
              rating: null,
              premarketName: null,
              instrumentName: null,
              latestPrice: null,
              currency: null,
              cached: false,
            }
          } catch (error) {
            console.error(`[premarket/batch-ratings] Error searching ${searchName}:`, error)
            return {
              company: searchName,
              isin: null,
              rating: null,
              premarketName: null,
              instrumentName: null,
              latestPrice: null,
              currency: null,
              cached: false,
            }
          }
        })
      )
      results.push(...chunkResults)
    }

    return NextResponse.json({ ok: true, ratings: results })
  } catch (error) {
    console.error('[premarket/batch-ratings] failed', error)
    return NextResponse.json(
      { ok: false, error: 'Premarket-Daten konnten nicht geladen werden.' },
      { status: 500 }
    )
  }
}
