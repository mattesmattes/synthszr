import { NextRequest, NextResponse } from 'next/server'
import { createAnonClient } from '@/lib/supabase/admin'
import type { StockSynthszrResult } from '@/lib/stock-synthszr/types'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

// Standard rate limiter for read operations (30 requests per minute per IP)
const standardLimiter = rateLimiters.standard()

// Company name to ticker symbol mapping (shared with stock-quote)
const COMPANY_TICKERS: Record<string, { symbol: string; exchange: string }> = {
  // Big Tech
  'apple': { symbol: 'AAPL', exchange: 'US' },
  'microsoft': { symbol: 'MSFT', exchange: 'US' },
  'google': { symbol: 'GOOGL', exchange: 'US' },
  'alphabet': { symbol: 'GOOGL', exchange: 'US' },
  'amazon': { symbol: 'AMZN', exchange: 'US' },
  'meta': { symbol: 'META', exchange: 'US' },
  'facebook': { symbol: 'META', exchange: 'US' },
  'nvidia': { symbol: 'NVDA', exchange: 'US' },
  'tesla': { symbol: 'TSLA', exchange: 'US' },
  'netflix': { symbol: 'NFLX', exchange: 'US' },

  // AI & Cloud
  'salesforce': { symbol: 'CRM', exchange: 'US' },
  'snowflake': { symbol: 'SNOW', exchange: 'US' },
  'palantir': { symbol: 'PLTR', exchange: 'US' },
  'crowdstrike': { symbol: 'CRWD', exchange: 'US' },
  'cloudflare': { symbol: 'NET', exchange: 'US' },

  // Semiconductors
  'intel': { symbol: 'INTC', exchange: 'US' },
  'amd': { symbol: 'AMD', exchange: 'US' },
  'qualcomm': { symbol: 'QCOM', exchange: 'US' },
  'broadcom': { symbol: 'AVGO', exchange: 'US' },
  'tsmc': { symbol: 'TSM', exchange: 'US' },
  'asml': { symbol: 'ASML', exchange: 'US' },
  'arm': { symbol: 'ARM', exchange: 'US' },

  // Social & Media
  'snap': { symbol: 'SNAP', exchange: 'US' },
  'snapchat': { symbol: 'SNAP', exchange: 'US' },
  'pinterest': { symbol: 'PINS', exchange: 'US' },
  'spotify': { symbol: 'SPOT', exchange: 'US' },
  'disney': { symbol: 'DIS', exchange: 'US' },
  'warner bros': { symbol: 'WBD', exchange: 'US' },
  'paramount': { symbol: 'PARA', exchange: 'US' },

  // E-commerce & Payments
  'shopify': { symbol: 'SHOP', exchange: 'US' },
  'paypal': { symbol: 'PYPL', exchange: 'US' },
  'square': { symbol: 'SQ', exchange: 'US' },
  'block': { symbol: 'SQ', exchange: 'US' },
  'ebay': { symbol: 'EBAY', exchange: 'US' },
  'etsy': { symbol: 'ETSY', exchange: 'US' },

  // Consulting & IT Services
  'accenture': { symbol: 'ACN', exchange: 'US' },

  // DevOps & Developer Tools
  'gitlab': { symbol: 'GTLB', exchange: 'US' },

  // Enterprise & SaaS
  'oracle': { symbol: 'ORCL', exchange: 'US' },
  'sap': { symbol: 'SAP', exchange: 'US' },
  'ibm': { symbol: 'IBM', exchange: 'US' },
  'adobe': { symbol: 'ADBE', exchange: 'US' },
  'servicenow': { symbol: 'NOW', exchange: 'US' },
  'workday': { symbol: 'WDAY', exchange: 'US' },
  'zoom': { symbol: 'ZM', exchange: 'US' },
  'slack': { symbol: 'CRM', exchange: 'US' },
  'atlassian': { symbol: 'TEAM', exchange: 'US' },
  'twilio': { symbol: 'TWLO', exchange: 'US' },
  'docusign': { symbol: 'DOCU', exchange: 'US' },

  // Automotive
  'volkswagen': { symbol: 'VOW3', exchange: 'XETRA' },
  'vw': { symbol: 'VOW3', exchange: 'XETRA' },
  'bmw': { symbol: 'BMW', exchange: 'XETRA' },
  'mercedes': { symbol: 'MBG', exchange: 'XETRA' },
  'daimler': { symbol: 'MBG', exchange: 'XETRA' },
  'porsche': { symbol: 'P911', exchange: 'XETRA' },
  'ford': { symbol: 'F', exchange: 'US' },
  'gm': { symbol: 'GM', exchange: 'US' },
  'general motors': { symbol: 'GM', exchange: 'US' },
  'rivian': { symbol: 'RIVN', exchange: 'US' },
  'lucid': { symbol: 'LCID', exchange: 'US' },

  // Finance
  'jpmorgan': { symbol: 'JPM', exchange: 'US' },
  'goldman sachs': { symbol: 'GS', exchange: 'US' },
  'morgan stanley': { symbol: 'MS', exchange: 'US' },
  'bank of america': { symbol: 'BAC', exchange: 'US' },
  'visa': { symbol: 'V', exchange: 'US' },
  'mastercard': { symbol: 'MA', exchange: 'US' },
  'coinbase': { symbol: 'COIN', exchange: 'US' },

  // German & European Industrial
  'siemens': { symbol: 'SIE', exchange: 'XETRA' },
  'schneider electric': { symbol: 'SU', exchange: 'PA' },
  'schneider': { symbol: 'SU', exchange: 'PA' },
  'allianz': { symbol: 'ALV', exchange: 'XETRA' },
  'deutsche bank': { symbol: 'DBK', exchange: 'XETRA' },
  'bayer': { symbol: 'BAYN', exchange: 'XETRA' },
  'basf': { symbol: 'BAS', exchange: 'XETRA' },
  'adidas': { symbol: 'ADS', exchange: 'XETRA' },
  'zalando': { symbol: 'ZAL', exchange: 'XETRA' },
  'delivery hero': { symbol: 'DHER', exchange: 'XETRA' },

  // Chinese Tech
  'tencent': { symbol: '0700', exchange: 'HK' },
  'baidu': { symbol: 'BIDU', exchange: 'US' },
  'alibaba': { symbol: 'BABA', exchange: 'US' },
  'jd': { symbol: 'JD', exchange: 'US' },
  'jd.com': { symbol: 'JD', exchange: 'US' },
  'netease': { symbol: 'NTES', exchange: 'US' },
  'pinduoduo': { symbol: 'PDD', exchange: 'US' },
  'pdd': { symbol: 'PDD', exchange: 'US' },
  'nio': { symbol: 'NIO', exchange: 'US' },
  'xpeng': { symbol: 'XPEV', exchange: 'US' },
  'li auto': { symbol: 'LI', exchange: 'US' },
  'byd': { symbol: '1211', exchange: 'HK' },
  'xiaomi': { symbol: '1810', exchange: 'HK' },
  'meituan': { symbol: '3690', exchange: 'HK' },
  'bilibili': { symbol: 'BILI', exchange: 'US' },
  'trip.com': { symbol: 'TCOM', exchange: 'US' },
  'ctrip': { symbol: 'TCOM', exchange: 'US' },
  'weibo': { symbol: 'WB', exchange: 'US' },
  'didi': { symbol: 'DIDIY', exchange: 'US' },
  'kuaishou': { symbol: '1024', exchange: 'HK' },
  'sea limited': { symbol: 'SE', exchange: 'US' },
  'grab': { symbol: 'GRAB', exchange: 'US' },

  // Korean
  'samsung': { symbol: '005930', exchange: 'KO' },

  // Others
  'uber': { symbol: 'UBER', exchange: 'US' },
  'airbnb': { symbol: 'ABNB', exchange: 'US' },
  'doordash': { symbol: 'DASH', exchange: 'US' },
  'roblox': { symbol: 'RBLX', exchange: 'US' },
  'unity': { symbol: 'U', exchange: 'US' },
  'robinhood': { symbol: 'HOOD', exchange: 'US' },
}

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
    if (companies.length > 20) {
      return NextResponse.json(
        { ok: false, error: 'Maximal 20 Unternehmen pro Anfrage' },
        { status: 400 }
      )
    }

    const supabase = createAnonClient()
    const apiKey = process.env.EODHD_API_KEY

    // Process all companies in parallel
    const results = await Promise.all(
      companies.map(async (company: unknown): Promise<BatchQuoteResult | null> => {
        if (typeof company !== 'string' || !company.trim()) return null

        const companyKey = company.trim().toLowerCase()
        const normalizedKey = companyKey.replace(/-/g, ' ')

        // Look up ticker info
        const tickerInfo = COMPANY_TICKERS[companyKey] || COMPANY_TICKERS[normalizedKey]

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
