import { createAdminClient } from '@/lib/supabase/admin'
import { COMPANY_TICKERS } from '@/lib/data/company-tickers'
import { KNOWN_COMPANIES } from '@/lib/data/companies'
import type { StockSynthszrResult } from '@/lib/stock-synthszr/types'

export interface VendorStock {
  /** Anzeigename (z.B. „Google"). */
  company: string
  /** Lowercase-Schlüssel für /api/stock-synthszr (Cache-Key). */
  companyKey: string
  /** Gecachte Stock-Synthszr-Analyse; null wenn noch nicht generiert. */
  data: StockSynthszrResult | null
  createdAt: string | null
}

/** Lesbaren Firmennamen aus dem KNOWN_COMPANIES-Dict (Name→Slug) ableiten,
 *  sonst den Vendor-Slug kapitalisieren. */
function displayName(key: string): string {
  const match = Object.entries(KNOWN_COMPANIES).find(([, slug]) => slug === key)
  if (match) return match[0]
  return key.charAt(0).toUpperCase() + key.slice(1)
}

/**
 * Für börsennotierte Hersteller (Vendor mit Ticker in COMPANY_TICKERS): liefert
 * die GECACHTE Stock-Synthszr-Analyse aus stock_synthszr_cache. Generiert NICHT
 * (die AI-Generierung ist teuer/langsam — das übernimmt der Client-Block on-view,
 * der Cron oder die Pre-Generierung). Rückgabe:
 *   - null            → Vendor ist nicht börsennotiert (kein Block)
 *   - data: null      → börsennotiert, aber noch nicht generiert (Block generiert on-view)
 *   - data: Result    → börsennotiert + gecacht (server-gerendert, SEO-fähig)
 */
export async function getVendorStockSynthszr(vendor: string): Promise<VendorStock | null> {
  const key = vendor?.trim().toLowerCase()
  if (!key || key === 'unknown' || !(key in COMPANY_TICKERS)) return null

  const supabase = createAdminClient()
  // Neuester Eintrag für die Firma (Währung egal — die Analyse ist im Kern
  // währungsunabhängig); auch abgelaufene zeigen (stale > nichts).
  const { data: cached } = await supabase
    .from('stock_synthszr_cache')
    .select('company, data, created_at')
    .ilike('company', key)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    company: displayName(key),
    companyKey: key,
    data: (cached?.data as StockSynthszrResult | undefined) ?? null,
    createdAt: (cached?.created_at as string | undefined) ?? null,
  }
}
