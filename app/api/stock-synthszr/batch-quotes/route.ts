import { NextRequest, NextResponse } from 'next/server'
import { createAnonClient } from '@/lib/supabase/admin'
import type { StockSynthszrResult } from '@/lib/stock-synthszr/types'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { getCompanyTicker, MAX_BATCH_SIZE } from '@/lib/data/companies'

// Standard rate limiter for read operations (30 requests per minute per IP)
const standardLimiter = rateLimiters.standard()

interface CacheRow {
  company: string
  currency: string
  data: StockSynthszrResult
  created_at: string
}

interface RealTimeQuote {
  code: string
  timestamp?: number
  open?: number
  high?: number
  low?: number
  close?: number
  previousClose?: number
  change?: number
  change_p?: number
  currency?: string
}

export interface BatchQuoteResult {
  company: string
  displayName: string
  ticker: string | null
  changePercent: number | null
  direction: 'up' | 'down' | 'neutral' | null
  rating: 'BUY' | 'HOLD' | 'SELL' | null
}

/**
 * Fetch quote data from EODHD API for a single company
 */
async function fetchQuote(
  tickerInfo: { symbol: string; exchange: string },
  apiKey: string
): Promise<{ changePercent: number; direction: 'up' | 'down' | 'neutral' } | null> {
  try {
    const url = `https://eodhistoricaldata.com/api/real-time/${tickerInfo.symbol}.${tickerInfo.exchange}?api_token=${apiKey}&fmt=json`
    const response = await fetch(url, {
      next: { revalidate: 300 }, // Cache for 5 minutes
    })

    if (!response.ok) {
      console.error(`[batch-quotes] EODHD error for ${tickerInfo.symbol}: ${response.status}`)
      return null
    }

    const data: RealTimeQuote = await response.json()
    const changePercent = data.change_p ?? 0
    const direction = changePercent > 0.5 ? 'up' : changePercent < -0.5 ? 'down' : 'neutral'

    return { changePercent, direction }
  } catch (error) {
    console.error(`[batch-quotes] Quote fetch error for ${tickerInfo.symbol}:`, error)
    return null
  }
}

/**
 * Batch endpoint to get cached Stock-Synthszr ratings AND quote data for multiple companies
 * Combines rating (BUY/HOLD/SELL) with ticker symbol and percentage change
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limit check - 30 requests per minute per IP
    const clientIP = getClientIP(request)
    const rateLimitResult = await checkRateLimit(`batch-quotes:${clientIP}`, standardLimiter ?? undefined)

    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult)
    }

    const payload = await request.json().catch(() => ({}))
    const companies = Array.isArray(payload?.companies) ? payload.companies : []

    if (companies.length === 0) {
      return NextResponse.json({ ok: true, quotes: [] })
    }

    // Limit to prevent abuse
    if (companies.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { ok: false, error: `Maximal ${MAX_BATCH_SIZE} Unternehmen pro Anfrage` },
        { status: 400 }
      )
    }

    const supabase = createAnonClient()
    const apiKey = process.env.EODHD_API_KEY

    // Process all companies in parallel
    const results = await Promise.all(
      companies.map(async (company: unknown): Promise<BatchQuoteResult | null> => {
        if (typeof company !== 'string' || !company.trim()) return null

        // Look up ticker info using centralized helper
        const tickerInfo = getCompanyTicker(company.trim())

        // Fetch rating from cache
        const { data: cached } = await supabase
          .from('stock_synthszr_cache')
          .select('company, data, created_at')
          .ilike('company', company.trim())
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .single<CacheRow>()

        const rating = cached?.data?.final_recommendation?.rating ?? null

        // If no ticker mapping, return rating only
        if (!tickerInfo) {
          return {
            company: company.trim(),
            displayName: company.trim(),
            ticker: null,
            changePercent: null,
            direction: null,
            rating,
          }
        }

        // Fetch quote data if we have API key
        let quoteData: { changePercent: number; direction: 'up' | 'down' | 'neutral' } | null = null
        if (apiKey) {
          quoteData = await fetchQuote(tickerInfo, apiKey)
        }

        // Format display name (capitalize first letter)
        const displayName = company.trim().charAt(0).toUpperCase() + company.trim().slice(1)

        return {
          company: company.trim(),
          displayName,
          ticker: tickerInfo.symbol,
          changePercent: quoteData?.changePercent ?? null,
          direction: quoteData?.direction ?? null,
          rating,
        }
      })
    )

    // Filter out nulls
    const validResults = results.filter((r): r is BatchQuoteResult => r !== null)

    return NextResponse.json({ ok: true, quotes: validResults })
  } catch (error) {
    console.error('[stock-synthszr/batch-quotes] failed', error)
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    )
  }
}
