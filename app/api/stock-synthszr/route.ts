import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchStockSynthszr } from '@/lib/stock-synthszr/fetch-synthesis'
import type { StockSynthszrResult } from '@/lib/stock-synthszr/types'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

// Allow longer timeout for AI generation
export const maxDuration = 120

// Strict rate limiter for expensive AI operations (5 requests per minute per IP)
const strictLimiter = rateLimiters.strict()

interface CacheRow {
  id: string
  company: string
  currency: string
  data: StockSynthszrResult
  model: string | null
  created_at: string
  expires_at: string
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit check - 5 requests per minute per IP for expensive AI operations
    const clientIP = getClientIP(request)
    const rateLimitResult = await checkRateLimit(`stock-synthszr:${clientIP}`, strictLimiter ?? undefined)

    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult)
    }

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

    const supabase = createAdminClient()

    // Check database cache unless force refresh
    if (!force) {
      const { data: cached } = await supabase
        .from('stock_synthszr_cache')
        .select('*')
        .ilike('company', company)
        .eq('currency', currency)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single<CacheRow>()

      if (cached) {
        console.log(`[stock-synthszr] Cache hit for ${company}`)
        const result = {
          ...cached.data,
          created_at: cached.created_at,
        }
        return NextResponse.json({ ok: true, data: result, cached: true })
      }
    }

    console.log(`[stock-synthszr] Generating synthesis for ${company}...`)

    const result = await fetchStockSynthszr({
      company,
      currency,
      price,
      recencyDays: 90,
    })

    // Store in database cache (14-day TTL)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) // 14 days

    const { error: insertError } = await supabase
      .from('stock_synthszr_cache')
      .upsert(
        {
          company: company.toLowerCase(),
          currency,
          data: result,
          model: result.model,
          created_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        },
        {
          onConflict: 'company,currency',
          ignoreDuplicates: false,
        }
      )

    if (insertError) {
      console.warn('[stock-synthszr] Cache insert failed:', insertError.message)
    } else {
      console.log(`[stock-synthszr] Cached result for ${company}`)
    }

    // Add created_at to result
    result.created_at = new Date().toISOString()

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
