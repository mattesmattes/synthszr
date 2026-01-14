'use client'

import { useEffect, useState } from 'react'
import { X, TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface StockQuoteData {
  symbol: string
  exchange: string
  displayName: string
  price: number
  previousClose: number
  open: number
  high: number
  low: number
  change: number
  changePercent: number
  direction: 'up' | 'down' | 'neutral'
  currency: string
}

interface StockQuotePopoverProps {
  company: string
  onClose: () => void
}

export function StockQuotePopover({ company, onClose }: StockQuotePopoverProps) {
  const [data, setData] = useState<StockQuoteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchQuote() {
      try {
        const res = await fetch(`/api/stock-quote?company=${encodeURIComponent(company)}`)
        if (!res.ok) {
          throw new Error('Kurs nicht verfügbar')
        }
        const quote = await res.json()
        setData(quote)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Laden')
      } finally {
        setLoading(false)
      }
    }
    fetchQuote()
  }, [company])

  const DirectionIcon = data?.direction === 'up' ? TrendingUp : data?.direction === 'down' ? TrendingDown : Minus
  const directionColor = data?.direction === 'up' ? 'text-[#39FF14]' : data?.direction === 'down' ? 'text-[#FF6600]' : 'text-gray-400'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-background border border-border rounded-lg shadow-xl w-full max-w-sm p-6">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
        >
          <X className="w-5 h-5" />
        </button>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-muted-foreground">{error}</div>
        ) : data ? (
          <>
            {/* Header */}
            <div className="mb-6">
              <h2 className="text-xl font-bold">{data.displayName}</h2>
              <p className="text-sm text-muted-foreground">{data.symbol} · {data.exchange}</p>
            </div>

            {/* Price */}
            <div className="flex items-baseline gap-3 mb-6">
              <span className="text-3xl font-bold">
                {data.price?.toFixed(2)} {data.currency}
              </span>
              <span className={`flex items-center gap-1 text-lg font-semibold ${directionColor}`}>
                <DirectionIcon className="w-5 h-5" />
                {data.changePercent >= 0 ? '+' : ''}{data.changePercent?.toFixed(2)}%
              </span>
            </div>

            {/* Details */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Vortag</span>
                <p className="font-medium">{data.previousClose?.toFixed(2)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Eröffnung</span>
                <p className="font-medium">{data.open?.toFixed(2)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Tageshoch</span>
                <p className="font-medium">{data.high?.toFixed(2)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Tagestief</span>
                <p className="font-medium">{data.low?.toFixed(2)}</p>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
