import { NextRequest, NextResponse } from 'next/server'
import { ensureStockSynthszr, ALLOWED_STOCK_CURRENCIES } from '@/lib/stock-synthszr/warm'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { readJsonBody, BoundedBodyError } from '@/lib/security/bounded-body'
import { isAdminRequest } from '@/lib/auth/session'
import { verifyBearerToken } from '@/lib/security/cron-auth'
import { KNOWN_COMPANIES } from '@/lib/data/companies'
import { COMPANY_TICKERS } from '@/lib/data/company-tickers'

// Allow longer timeout for AI generation
export const maxDuration = 120

// Strict rate limiter for expensive AI operations (5 requests per minute per IP)
const strictLimiter = rateLimiters.strict()

const KNOWN_PUBLIC_KEYS = new Set<string>([
  ...Object.keys(KNOWN_COMPANIES).map((k) => k.toLowerCase()),
  ...Object.values(KNOWN_COMPANIES).map((v) => v.toLowerCase()),
  ...Object.keys(COMPANY_TICKERS).map((k) => k.toLowerCase()),
])

export async function POST(request: NextRequest) {
  try {
    // Rate limit check - 5 requests per minute per IP for expensive AI operations
    const clientIP = getClientIP(request)
    const rateLimitResult = await checkRateLimit(`stock-synthszr:${clientIP}`, strictLimiter ?? undefined)

    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult)
    }

    let payload: Record<string, unknown>
    try {
      const parsed = await readJsonBody(request, 8 * 1024)
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

    const company = typeof payload?.company === 'string' ? payload.company.trim() : ''

    if (!company || company.length > 100 || /[\r\n]/.test(company)) {
      return NextResponse.json(
        { ok: false, error: 'Parameter "company" fehlt oder ist ungültig.' },
        { status: 400 }
      )
    }

    const rawCurrency = typeof payload?.currency === 'string' ? payload.currency.trim().toUpperCase() : 'EUR'
    if (!ALLOWED_STOCK_CURRENCIES.has(rawCurrency)) {
      return NextResponse.json(
        { ok: false, error: 'Ungültige Währung.' },
        { status: 400 }
      )
    }

    const requestedForce = Boolean(payload?.force)
    const requestedPrice = typeof payload?.price === 'number' && Number.isFinite(payload.price) && payload.price > 0 ? payload.price : null

    const isCron = verifyBearerToken(request.headers.get('authorization'), process.env.CRON_SECRET)
    const isPrivileged = isCron || (await isAdminRequest(request))

    // Unauthenticated callers may only request known listed companies, never force-refresh or inject custom prices
    if (!isPrivileged && !KNOWN_PUBLIC_KEYS.has(company.toLowerCase())) {
      return NextResponse.json(
        { ok: false, error: 'Unbekanntes Unternehmen.' },
        { status: 400 }
      )
    }

    const force = isPrivileged ? requestedForce : false
    const price = isPrivileged ? requestedPrice : null

    const { data, cached } = await ensureStockSynthszr({ company, currency: rawCurrency, price, force })
    return NextResponse.json(cached ? { ok: true, data, cached: true } : { ok: true, data })
  } catch (error) {
    console.error('[stock-synthszr] failed', error)
    return NextResponse.json(
      { ok: false, error: 'Analyse konnte nicht geladen werden.' },
      { status: 502 }
    )
  }
}
