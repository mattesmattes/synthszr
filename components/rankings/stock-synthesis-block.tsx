'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { StockSynthszrResult, StockRating } from '@/lib/stock-synthszr/types'
import { analysisLabels } from '@/lib/rankings/analysis-labels'

/** Markdown-Links [text](url) → klickbare <a>, Rest als Text. */
function mdLinks(text: string): ReactNode {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/)
  if (parts.length === 1) return text
  return parts.map((part, i) => {
    const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (m) return <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer" className="underline hover:text-black">{m[1]}</a>
    return <span key={i}>{part}</span>
  })
}

function ratingClass(r: StockRating): string {
  if (r === 'BUY') return 'bg-green-500 text-white'
  if (r === 'SELL') return 'bg-orange-600 text-white'
  if (r === 'HOLD') return 'bg-yellow-400 text-black'
  return 'bg-gray-200 text-gray-700'
}

/**
 * Unternehmens-Analyse für börsennotierte Hersteller (Stock-Synthszr), analog
 * zum Premarket-Block. Server-Props (`initial`) werden sofort gerendert
 * (SEO-fähig); fehlt der Cache, wird die Analyse einmalig on-view generiert
 * (POST /api/stock-synthszr) und der Cache damit „aufgewärmt".
 */
export function StockSynthesisBlock({
  company,
  companyKey,
  initial,
  createdAt,
  stale,
  locale = 'de',
}: {
  company: string
  companyKey: string
  initial: StockSynthszrResult | null
  createdAt: string | null
  stale: boolean
  locale?: string
}) {
  const L = analysisLabels(locale)
  const [data, setData] = useState<StockSynthszrResult | null>(initial)
  const [stand, setStand] = useState<string | null>(createdAt)
  const [refreshing, setRefreshing] = useState(false)
  const triggered = useRef(false)
  const [quote, setQuote] = useState<{ symbol: string; price: number; changePercent: number; direction: 'up' | 'down' | 'neutral'; currency: string } | null>(null)

  // Aktienkurs des börsennotierten Herstellers (analog zu den Artikeln). 404 → kein Kurs.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/stock-quote?company=${encodeURIComponent(companyKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((q) => { if (!cancelled && q?.price != null) setQuote(q) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [companyKey])

  // Bei stale (abgelaufen >14 Tage ODER kein Cache): einmalig neu generieren.
  // Vorhandene (veraltete) Analyse bleibt sichtbar, bis die frische ankommt.
  useEffect(() => {
    if (!stale || triggered.current) return
    triggered.current = true
    let cancelled = false
    setRefreshing(true)
    fetch('/api/stock-synthszr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: companyKey, currency: 'EUR' }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return
        if (json?.ok && json.data) { setData(json.data as StockSynthszrResult); setStand(json.data.created_at ?? null) }
      })
      .catch(() => { /* Netzfehler → veraltete Analyse bleibt stehen */ })
      .finally(() => { if (!cancelled) setRefreshing(false) })
    return () => { cancelled = true }
  }, [stale, companyKey])

  if (!data && !refreshing) return null // nichts da und nichts unterwegs → ausblenden

  return (
    <section className="mt-8 border-t pt-6">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{L.heading}: {company}</h2>
          {quote && (
            <a href={`https://www.google.com/search?q=${quote.symbol}+stock`} target="_blank" rel="noopener noreferrer" className="inline-flex items-baseline gap-1.5 text-sm mt-0.5 hover:underline">
              <span className="font-mono font-semibold">{quote.symbol}</span>
              <span className="tabular-nums">{quote.price.toFixed(2)} {quote.currency}</span>
              <span className={quote.direction === 'up' ? 'text-green-600' : quote.direction === 'down' ? 'text-orange-600' : 'text-gray-400'}>
                {quote.changePercent >= 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%
              </span>
            </a>
          )}
        </div>
        <span className="flex items-center gap-2 text-[11px] text-gray-400 shrink-0">
          {refreshing && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500" />
              {data ? L.updating : L.generating}
            </span>
          )}
          {stand && <span>{L.asOf} {new Date(stand).toLocaleDateString(L.dateLocale)}</span>}
        </span>
      </div>

      {data && (
        <>
          {/* Synthszr Vote */}
          {data.final_recommendation && (
            <div className="rounded-xl border border-gray-200 p-4 mb-5">
              <div className="flex items-center gap-2 mb-2">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${ratingClass(data.final_recommendation.rating)}`}>{data.final_recommendation.rating}</span>
                <span className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Synthszr Vote</span>
              </div>
              {data.final_recommendation.rationale && <p className="text-sm text-gray-800 leading-snug">{mdLinks(data.final_recommendation.rationale)}</p>}
            </div>
          )}

          {/* Executive Summary */}
          {data.executive_summary && (
            <div className="mb-5">
              <h3 className="text-sm font-semibold mb-2">{L.summary}</h3>
              <p className="text-sm text-gray-800 leading-snug">{mdLinks(data.executive_summary)}</p>
            </div>
          )}

          {/* Key Takeaways */}
          {data.key_takeaways?.length > 0 && (
            <div className="mb-5">
              <h3 className="text-sm font-semibold mb-2">Key Takeaways</h3>
              <ol className="space-y-1.5 list-decimal list-inside text-sm text-gray-800">
                {data.key_takeaways.map((t, i) => <li key={i} className="leading-snug">{mdLinks(t)}</li>)}
              </ol>
            </div>
          )}

          {/* Action-Ideen */}
          {data.action_ideas?.length > 0 && (
            <div className="mb-5">
              <h3 className="text-sm font-semibold mb-2">{L.actionIdeas}</h3>
              <div className="grid sm:grid-cols-3 gap-2">
                {data.action_ideas.map((a, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 p-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ratingClass(a.rating)}`}>{a.rating}</span>
                    <p className="text-xs text-gray-700 mt-1.5 leading-snug">{a.thesis}</p>
                    {a.time_horizon_months != null && <p className="text-[10px] text-gray-400 mt-1">{L.horizon}: {a.time_horizon_months} {L.months}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contrarian Insights */}
          {data.contrarian_insights?.length > 0 && (
            <div className="mb-5">
              <h3 className="text-sm font-semibold mb-2">Contrarian Insights</h3>
              <ul className="space-y-1.5 text-sm text-gray-800 bg-[#CCFF00]/10 rounded-lg p-3">
                {data.contrarian_insights.map((c, i) => <li key={i} className="leading-snug">• {mdLinks(c)}</li>)}
              </ul>
            </div>
          )}

          {/* Quellen */}
          {data.sources?.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-1">{L.sources} ({data.sources.length})</h3>
              <ul className="text-xs text-gray-500 space-y-0.5">
                {data.sources.slice(0, 12).map((src, i) => (
                  <li key={i} className="truncate">
                    <a href={src.startsWith('http') ? src : `https://${src}`} target="_blank" rel="noopener noreferrer" className="underline hover:text-black">{src}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
