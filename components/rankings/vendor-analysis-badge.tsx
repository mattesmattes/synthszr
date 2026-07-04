'use client'

import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { StockQuotePopover } from '@/components/stock-quote-popover'
import { StockSynthszrLayer } from '@/components/stock-synthszr-layer'
import { PremarketSynthszrLayer } from '@/components/premarket-synthszr-layer'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import { trackEvent } from '@/lib/analytics/tracker'
import { DIRECTION_STYLES, DIRECTION_ARROWS } from '@/lib/synthszr/rating-styles'

/** Klassifiziert die Firma als börsennotiert (public) oder pre-IPO (premarket)
 *  über die Firmen-Dictionaries (exakt, dann case-insensitiv). Fallback
 *  premarket — die Analyse-Sektion rendert ohnehin nur für Premarket-Vendors. */
function classify(company: string): 'public' | 'premarket' {
  if (company in KNOWN_PREMARKET_COMPANIES) return 'premarket'
  if (company in KNOWN_COMPANIES) return 'public'
  const lc = company.toLowerCase()
  if (Object.keys(KNOWN_PREMARKET_COMPANIES).some((k) => k.toLowerCase() === lc)) return 'premarket'
  if (Object.keys(KNOWN_COMPANIES).some((k) => k.toLowerCase() === lc)) return 'public'
  return 'premarket'
}

/** Neben der Unternehmens-Analyse-Headline: Kurs-Badge NUR für börsennotierte
 *  Firmen (Realtime via StockQuotePopover) plus ein Link zum Synthszr-Analyzer
 *  (Analyse-Dialog wie in den Artikeln) für private UND public Firmen. Private
 *  Firmen haben keine eigene Aktie → kein Kurs-Badge, nur der Analyzer-Link. */
export function VendorAnalysisBadge({ company }: { company: string }) {
  const kind = classify(company)
  const [quote, setQuote] = useState<{ changePercent: number; direction: 'up' | 'down' | 'neutral' } | null>(null)
  const [showQuote, setShowQuote] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(false)

  // Kurs nur für börsennotierte Firmen — private Firmen liefern seit dem
  // Entfernen der Proxy-Mappings 404 (kein fremder Aktienkurs mehr).
  useEffect(() => {
    if (kind !== 'public' || !company.trim()) return
    let cancelled = false
    fetch(`/api/stock-quote?company=${encodeURIComponent(company)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.changePercent === 'number' && d.direction) {
          setQuote({ changePercent: d.changePercent, direction: d.direction })
        }
      })
      .catch(() => { /* kein Kurs → kein Badge */ })
    return () => { cancelled = true }
  }, [company, kind])

  return (
    <span className="inline-flex items-center gap-2">
      {quote && (
        <button
          onClick={() => { trackEvent('stock_ticker_click', { company }); setShowQuote(true) }}
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold transition-opacity hover:opacity-80 ${DIRECTION_STYLES[quote.direction]}`}
          aria-label="Realtime-Kurs anzeigen"
          title="Realtime-Kurs anzeigen"
        >
          {DIRECTION_ARROWS[quote.direction]}{Math.abs(quote.changePercent).toFixed(1)}%
        </button>
      )}
      <button
        onClick={() => { trackEvent('synthszr_vote_click', { company }); setShowAnalysis(true) }}
        className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 transition-colors hover:text-black"
        aria-label="Synthszr-Analyse öffnen"
      >
        Synthszr-Analyse <ExternalLink className="h-3 w-3" />
      </button>

      {showQuote && <StockQuotePopover company={company} onClose={() => setShowQuote(false)} />}
      {showAnalysis && (
        kind === 'premarket'
          ? <PremarketSynthszrLayer company={company} onClose={() => setShowAnalysis(false)} />
          : <StockSynthszrLayer company={company} onClose={() => setShowAnalysis(false)} />
      )}
    </span>
  )
}
