import { createClient } from '@supabase/supabase-js'
import { fetchStockSynthszr } from './fetch-synthesis'
import type { StockSynthszrResult } from './types'

interface TipTapNode {
  type?: string
  attrs?: {
    symbol?: string
    name?: string
    currency?: string
  }
  content?: TipTapNode[]
}

// Supabase client for cache operations
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * Extract all stock ticker symbols from TipTap JSON content
 */
export function extractStockTickers(content: TipTapNode | string): Array<{ symbol: string; name: string; currency: string }> {
  const tickers: Array<{ symbol: string; name: string; currency: string }> = []
  const seen = new Set<string>()

  function traverse(node: TipTapNode) {
    if (node.type === 'stockTicker' && node.attrs?.symbol) {
      const key = `${node.attrs.symbol}-${node.attrs.currency || 'EUR'}`
      if (!seen.has(key)) {
        seen.add(key)
        tickers.push({
          symbol: node.attrs.symbol,
          name: node.attrs.name || node.attrs.symbol,
          currency: node.attrs.currency || 'EUR',
        })
      }
    }
    if (node.content) {
      for (const child of node.content) {
        traverse(child)
      }
    }
  }

  const parsedContent = typeof content === 'string' ? JSON.parse(content) : content
  traverse(parsedContent)
  return tickers
}

interface CacheRow {
  company: string
  currency: string
  data: StockSynthszrResult
  created_at: string
  expires_at: string
}

/**
 * Check which stocks need pre-generation (not cached or expired)
 */
export async function getStocksNeedingGeneration(
  tickers: Array<{ symbol: string; name: string; currency: string }>
): Promise<Array<{ symbol: string; name: string; currency: string }>> {
  if (tickers.length === 0) return []

  const supabase = getSupabase()
  const needsGeneration: Array<{ symbol: string; name: string; currency: string }> = []

  for (const ticker of tickers) {
    // Check if we have a valid (non-expired) cache entry
    const { data: cached } = await supabase
      .from('stock_synthszr_cache')
      .select('expires_at')
      .ilike('company', ticker.name)
      .eq('currency', ticker.currency)
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .single<CacheRow>()

    if (!cached) {
      needsGeneration.push(ticker)
    }
  }

  return needsGeneration
}

/**
 * Pre-generate Stock-Synthszr for all stocks mentioned in content
 * Returns the number of stocks generated
 */
export async function pregenerateStockSynthszr(
  content: TipTapNode | string
): Promise<{ generated: number; skipped: number; errors: number }> {
  const tickers = extractStockTickers(content)
  console.log(`[stock-synthszr] Found ${tickers.length} unique stock tickers in content`)

  if (tickers.length === 0) {
    return { generated: 0, skipped: 0, errors: 0 }
  }

  const needsGeneration = await getStocksNeedingGeneration(tickers)
  const skipped = tickers.length - needsGeneration.length

  console.log(`[stock-synthszr] ${skipped} stocks already cached, ${needsGeneration.length} need generation`)

  let generated = 0
  let errors = 0
  const supabase = getSupabase()

  for (const ticker of needsGeneration) {
    try {
      console.log(`[stock-synthszr] Pre-generating for ${ticker.name} (${ticker.currency})...`)

      const result = await fetchStockSynthszr({
        company: ticker.name,
        currency: ticker.currency,
        recencyDays: 90,
      })

      // Store in cache
      const { error: insertError } = await supabase
        .from('stock_synthszr_cache')
        .upsert(
          {
            company: ticker.name.toLowerCase(),
            currency: ticker.currency,
            data: result,
            model: result.model,
          },
          {
            onConflict: 'company,currency',
            ignoreDuplicates: false,
          }
        )

      if (insertError) {
        console.warn(`[stock-synthszr] Cache insert failed for ${ticker.name}:`, insertError.message)
      }

      generated++
      console.log(`[stock-synthszr] Successfully pre-generated for ${ticker.name}`)
    } catch (error) {
      errors++
      console.error(`[stock-synthszr] Failed to pre-generate for ${ticker.name}:`, error)
    }
  }

  return { generated, skipped, errors }
}
