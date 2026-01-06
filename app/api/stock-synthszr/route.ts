import { NextRequest, NextResponse } from 'next/server'
import { fetchStockSynthszr } from '@/lib/stock-synthszr/fetch-synthesis'

// Allow longer timeout for AI generation
export const maxDuration = 120

// Simple in-memory cache (24h TTL)
const cache = new Map<string, { data: unknown; timestamp: number }>()
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}))
    const company = typeof payload?.company === 'string' ? payload.company.trim() : ''

    if (!company) {
      return NextResponse.json(
        { ok: false, error: 'Parameter "company" fehlt.' },
        { status: 400 }
      )
    }

    const force = Boolean(payload?.force)
    const currency = typeof payload?.currency === 'string' ? payload.currency : 'EUR'
    const price = typeof payload?.price === 'number' ? payload.price : null

    const cacheKey = `${company.toLowerCase()}-${currency}`

    // Check cache unless force refresh
    if (!force) {
      const cached = cache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`[stock-synthszr] Cache hit for ${company}`)
        return NextResponse.json({ ok: true, data: cached.data, cached: true })
      }
    }

    console.log(`[stock-synthszr] Generating synthesis for ${company}...`)

    const result = await fetchStockSynthszr({
      company,
      currency,
      price,
      recencyDays: 90,
    })

    // Update cache
    cache.set(cacheKey, { data: result, timestamp: Date.now() })

    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    console.error('[stock-synthszr] failed', error)
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 }
    )
  }
}
