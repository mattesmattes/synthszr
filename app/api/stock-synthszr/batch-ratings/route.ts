import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { StockSynthszrResult } from '@/lib/stock-synthszr/types'

// Supabase client for reading cache
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

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
    const payload = await request.json().catch(() => ({}))
    const companies = Array.isArray(payload?.companies) ? payload.companies : []
    const currency = typeof payload?.currency === 'string' ? payload.currency : 'EUR'

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

    const supabase = getSupabase()
    const results: StockRatingResult[] = []

    // Query cache for each company
    for (const company of companies) {
      if (typeof company !== 'string' || !company.trim()) continue

      const { data: cached } = await supabase
        .from('stock_synthszr_cache')
        .select('company, data, created_at')
        .ilike('company', company.trim())
        .eq('currency', currency)
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
