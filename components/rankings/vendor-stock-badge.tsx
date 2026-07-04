'use client'

import { useEffect, useState } from 'react'
import { StockQuotePopover } from '@/components/stock-quote-popover'
import { trackEvent } from '@/lib/analytics/tracker'
import { DIRECTION_STYLES, DIRECTION_ARROWS } from '@/lib/synthszr/rating-styles'

/** Kurs-Badge neben der Unternehmens-Analyse auf Produktseiten — spiegelt die
 *  Aktienkurs-Anzeige der Artikel: Change% (via /api/stock-quote, Proxy-Ticker
 *  für Pre-IPO-Firmen wie OpenAI→MSFT, Anthropic→AMZN), Klick öffnet den
 *  Realtime-Kurs (StockQuotePopover). Rendert nichts, wenn kein Kurs auflösbar. */
export function VendorStockBadge({ company }: { company: string }) {
  const [quote, setQuote] = useState<{ changePercent: number; direction: 'up' | 'down' | 'neutral' } | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!company.trim()) return
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
  }, [company])

  if (!quote) return null

  return (
    <>
      <button
        onClick={() => { trackEvent('stock_ticker_click', { company }); setOpen(true) }}
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold transition-opacity hover:opacity-80 ${DIRECTION_STYLES[quote.direction]}`}
        aria-label="Realtime-Kurs anzeigen"
        title="Realtime-Kurs anzeigen"
      >
        {DIRECTION_ARROWS[quote.direction]}{Math.abs(quote.changePercent).toFixed(1)}%
      </button>
      {open && <StockQuotePopover company={company} onClose={() => setOpen(false)} />}
    </>
  )
}
