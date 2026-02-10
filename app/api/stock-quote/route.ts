import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

// Common company name to ticker symbol mapping
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
  'openai': { symbol: 'MSFT', exchange: 'US' }, // Microsoft is major investor
  'anthropic': { symbol: 'AMZN', exchange: 'US' }, // Amazon is major investor
  'salesforce': { symbol: 'CRM', exchange: 'US' },
  'snowflake': { symbol: 'SNOW', exchange: 'US' },
  'palantir': { symbol: 'PLTR', exchange: 'US' },
  'databricks': { symbol: 'SNOW', exchange: 'US' }, // Private, use Snowflake as proxy
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
  'stripe': { symbol: 'PYPL', exchange: 'US' }, // Private, use PayPal as proxy
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
  'slack': { symbol: 'CRM', exchange: 'US' }, // Owned by Salesforce
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

export async function GET(request: NextRequest) {
  // Rate limit: 30 requests per minute per IP
  const ip = getClientIP(request)
  const limiter = rateLimiters.standard()
  const rl = await checkRateLimit(`stock-quote:${ip}`, limiter ?? undefined)
  if (!rl.success) return rateLimitResponse(rl)

  const { searchParams } = new URL(request.url)
  const company = searchParams.get('company')?.toLowerCase().trim()

  if (!company) {
    return NextResponse.json({ error: 'Company name required' }, { status: 400 })
  }

  // Normalize company name: convert hyphens to spaces for lookup
  // (KNOWN_COMPANIES uses hyphens like 'schneider-electric', COMPANY_TICKERS uses spaces)
  const normalizedCompany = company.replace(/-/g, ' ')

  // Find ticker for company (try both original and normalized)
  const tickerInfo = COMPANY_TICKERS[company] || COMPANY_TICKERS[normalizedCompany]
  if (!tickerInfo) {
    return NextResponse.json({ error: 'Company not found', company }, { status: 404 })
  }

  const apiKey = process.env.EODHD_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
  }

  try {
    const url = `https://eodhistoricaldata.com/api/real-time/${tickerInfo.symbol}.${tickerInfo.exchange}?api_token=${apiKey}&fmt=json`

    // Add timeout to prevent hanging on unresponsive API
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

    const response = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 300 }, // Cache for 5 minutes
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`EODHD API error: ${response.status}`)
    }

    const data: RealTimeQuote = await response.json()

    // Calculate performance - neutral threshold is ±0.5%
    const changePercent = data.change_p ?? 0
    const direction = changePercent > 0.5 ? 'up' : changePercent < -0.5 ? 'down' : 'neutral'

    // Format company name for display
    const displayName = Object.entries(COMPANY_TICKERS).find(
      ([, info]) => info.symbol === tickerInfo.symbol && info.exchange === tickerInfo.exchange
    )?.[0] || company

    return NextResponse.json({
      symbol: tickerInfo.symbol,
      exchange: tickerInfo.exchange,
      displayName: displayName.charAt(0).toUpperCase() + displayName.slice(1),
      price: data.close,
      previousClose: data.previousClose,
      open: data.open,
      high: data.high,
      low: data.low,
      change: data.change,
      changePercent: changePercent,
      direction,
      timestamp: data.timestamp,
      currency: data.currency || 'USD',
    })
  } catch (error) {
    console.error('Stock quote error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch quote' },
      { status: 500 }
    )
  }
}
