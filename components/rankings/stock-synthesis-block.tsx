'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { StockSynthszrResult, StockRating } from '@/lib/stock-synthszr/types'

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
}: {
  company: string
  companyKey: string
  initial: StockSynthszrResult | null
  createdAt: string | null
}) {
  const [data, setData] = useState<StockSynthszrResult | null>(initial)
  const [stand, setStand] = useState<string | null>(createdAt)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (data || loading || failed) return
    let cancelled = false
    setLoading(true)
    fetch('/api/stock-synthszr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: companyKey, currency: 'EUR' }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return
        if (json?.ok && json.data) { setData(json.data as StockSynthszrResult); setStand(json.data.created_at ?? null) }
        else setFailed(true)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [data, loading, failed, companyKey])

  if (failed && !data) return null // Analyse nicht verfügbar → Sektion ausblenden

  return (
    <section className="mt-8 border-t pt-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold">Unternehmens-Analyse: {company}</h2>
        {stand && <span className="text-[11px] text-gray-400">Stand {new Date(stand).toLocaleDateString('de-DE')}</span>}
      </div>

      {!data && loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          Synthszr-Analyse wird erstellt …
        </div>
      )}

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
              <h3 className="text-sm font-semibold mb-2">Zusammenfassung</h3>
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
              <h3 className="text-sm font-semibold mb-2">Action-Ideen</h3>
              <div className="grid sm:grid-cols-3 gap-2">
                {data.action_ideas.map((a, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 p-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ratingClass(a.rating)}`}>{a.rating}</span>
                    <p className="text-xs text-gray-700 mt-1.5 leading-snug">{a.thesis}</p>
                    {a.time_horizon_months != null && <p className="text-[10px] text-gray-400 mt-1">Horizont: {a.time_horizon_months} Mon.</p>}
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
              <h3 className="text-sm font-semibold mb-1">Quellen ({data.sources.length})</h3>
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
