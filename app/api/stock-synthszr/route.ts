import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchStockSynthszr } from '@/lib/stock-synthszr/fetch-synthesis'
import type { StockSynthszrResult } from '@/lib/stock-synthszr/types'

// Allow longer timeout for AI generation
export const maxDuration = 120

// Supabase client for caching (uses service role for writes)
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

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

    const supabase = getSupabase()

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

    // Store in database cache (14-day TTL is set by default in the table)
    const { error: insertError } = await supabase
      .from('stock_synthszr_cache')
      .upsert(
        {
          company: company.toLowerCase(),
          currency,
          data: result,
          model: result.model,
        },
        {
          onConflict: 'company,currency',
          ignoreDuplicates: false,
        }
      )

    if (insertError) {
      console.warn('[stock-synthszr] Cache insert failed:', insertError.message)
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
