'use client'

import { useEffect, useState } from 'react'

interface StockQuote {
  symbol: string
  exchange: string
  price: number
  change: number
  changePercent: number
  direction: 'up' | 'down' | 'neutral'
}

interface StockTickerProps {
  company: string
}

export function StockTicker({ company }: StockTickerProps) {
  const [quote, setQuote] = useState<StockQuote | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function fetchQuote() {
      try {
        const res = await fetch(`/api/stock-quote?company=${encodeURIComponent(company)}`)
        if (!res.ok) {
          setError(true)
          return
        }
        const data = await res.json()
        setQuote(data)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }

    fetchQuote()
  }, [company])

  if (loading) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground animate-pulse">
        (...)
      </span>
    )
  }

  if (error || !quote) {
    return null // Don't show anything if we can't get the quote
  }

  const arrow = quote.direction === 'up' ? '↑' : quote.direction === 'down' ? '↓' : '→'

  // Background colors: Positive=Neon Green, Neutral=Gray, Negative=Neon Orange
  const bgClass = quote.direction === 'up'
    ? 'bg-[#39FF14]'  // Neon Green
    : quote.direction === 'down'
    ? 'bg-[#FF6600]'  // Neon Orange
    : 'bg-gray-300 dark:bg-gray-600'  // Gray

  const formattedPercent = Math.abs(quote.changePercent).toFixed(1)

  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium text-black px-1.5 py-0.5 rounded ${bgClass}`}>
      <span>{arrow}{formattedPercent}%</span>
    </span>
  )
}

// Known public companies for matching
export const KNOWN_COMPANIES = [
  'Apple', 'Microsoft', 'Google', 'Alphabet', 'Amazon', 'Meta', 'Facebook',
  'Nvidia', 'Tesla', 'Netflix', 'OpenAI', 'Anthropic', 'Salesforce',
  'Snowflake', 'Palantir', 'CrowdStrike', 'Cloudflare', 'Intel', 'AMD',
  'Qualcomm', 'Broadcom', 'TSMC', 'ASML', 'ARM', 'Snap', 'Snapchat',
  'Pinterest', 'Spotify', 'Disney', 'Shopify', 'PayPal', 'Square', 'Block',
  'eBay', 'Etsy', 'Oracle', 'SAP', 'IBM', 'Adobe', 'ServiceNow', 'Workday',
  'Zoom', 'Slack', 'Atlassian', 'Twilio', 'DocuSign', 'Volkswagen', 'VW',
  'BMW', 'Mercedes', 'Daimler', 'Porsche', 'Ford', 'GM', 'Rivian', 'Lucid',
  'JPMorgan', 'Goldman Sachs', 'Morgan Stanley', 'Visa', 'Mastercard',
  'Coinbase', 'Siemens', 'Allianz', 'Deutsche Bank', 'Bayer', 'BASF',
  'Adidas', 'Zalando', 'Uber', 'Airbnb', 'DoorDash', 'Roblox', 'Unity',
  'Robinhood', 'Samsung'
]
