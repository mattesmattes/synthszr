/**
 * Synthszr-Rating einer Firma sicherstellen: Cache-Treffer zurückgeben, sonst
 * frisch generieren, cachen und die Produktseiten revalidieren (2026-10-19).
 * Kern von POST /api/stock-synthszr, herausgezogen, weil der Artikel-Job die
 * Ratings jetzt serverseitig vorwärmt (Schritt „Assets“) — ein HTTP-Aufruf der
 * eigenen Route aus dem Cron lief in Redirects und 401 (s. scheduled-tasks).
 */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchStockSynthszr } from '@/lib/stock-synthszr/fetch-synthesis'
import type { StockSynthszrResult } from '@/lib/stock-synthszr/types'
import { namespacesForCompany } from '@/lib/rankings/vendor-canonical'
import { STOCK_SYNTHSZR_CACHE_MS } from '@/lib/config/constants'

interface CacheRow {
  company: string
  currency: string
  data: StockSynthszrResult
  created_at: string
  expires_at: string
}

export interface EnsureStockSynthszrInput {
  company: string
  currency?: string
  price?: number | null
  force?: boolean
}

export async function ensureStockSynthszr(input: EnsureStockSynthszrInput): Promise<{ data: StockSynthszrResult & { created_at?: string }; cached: boolean }> {
  const company = input.company.trim()
  const currency = input.currency ?? 'EUR'
  const price = input.price ?? null
  const supabase = createAdminClient()

  if (!input.force) {
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
      return { data: { ...cached.data, created_at: cached.created_at }, cached: true }
    }
  }

  console.log(`[stock-synthszr] Generating synthesis for ${company}...`)
  const result = await fetchStockSynthszr({ company, currency, price, recencyDays: 90 })

  const now = new Date()
  const expiresAt = new Date(now.getTime() + STOCK_SYNTHSZR_CACHE_MS)
  const { error: insertError } = await supabase
    .from('stock_synthszr_cache')
    .upsert(
      { company: company.toLowerCase(), currency, data: result, model: result.model, created_at: now.toISOString(), expires_at: expiresAt.toISOString() },
      { onConflict: 'company,currency', ignoreDuplicates: false },
    )
  if (insertError) console.warn('[stock-synthszr] Cache insert failed:', insertError.message)
  else console.log(`[stock-synthszr] Cached result for ${company}`)

  // Frisch generiert → die Produktseiten dieser Firma revalidieren, damit die neue
  // Analyse sofort erscheint (statt erst nach dem 5-min-ISR-Fenster).
  try {
    const namespaces = namespacesForCompany(company.toLowerCase())
    const { data: prods } = await supabase
      .from('products')
      .select('slug')
      .in('vendor_namespace', namespaces)
      .eq('visibility_status', 'visible')
    for (const p of prods ?? []) {
      revalidatePath(`/de/rankings/${p.slug}`)
      revalidatePath(`/en/rankings/${p.slug}`)
    }
  } catch (e) {
    console.warn('[stock-synthszr] revalidate failed:', e instanceof Error ? e.message : e)
  }

  const withTimestamp = result as StockSynthszrResult & { created_at?: string }
  withTimestamp.created_at = new Date().toISOString()
  return { data: withTimestamp, cached: false }
}
