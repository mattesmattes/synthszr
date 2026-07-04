import type { ReactNode } from 'react'
import type { PremarketSynthesis, PremarketRating } from '@/lib/premarket/types'
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

function ratingClass(r: PremarketRating | null): string {
  if (r === 'BUY') return 'bg-green-500 text-white'
  if (r === 'SELL') return 'bg-orange-600 text-white'
  if (r === 'HOLD') return 'bg-yellow-400 text-black'
  return 'bg-gray-200 text-gray-700'
}

export function PremarketSynthesisBlock({ company, synthesis: s, locale = 'de' }: { company: string; synthesis: PremarketSynthesis; locale?: string }) {
  const L = analysisLabels(locale)
  return (
    <section className="mt-8 border-t pt-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold">{L.heading}: {company}</h2>
        {s.updatedAt && <span className="text-[11px] text-gray-400">{L.asOf} {new Date(s.updatedAt).toLocaleDateString(L.dateLocale)}</span>}
      </div>

      {/* Synthszr Vote */}
      {(s.rating || s.rationale) && (
        <div className="rounded-xl border border-gray-200 p-4 mb-5">
          <div className="flex items-center gap-2 mb-2">
            {s.rating && <span className={`px-2 py-0.5 rounded text-xs font-bold ${ratingClass(s.rating)}`}>{s.rating}</span>}
            <span className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Synthszr Vote</span>
          </div>
          {s.rationale && <p className="text-sm text-gray-800 leading-snug">{mdLinks(s.rationale)}</p>}
        </div>
      )}

      {/* Key Takeaways */}
      {s.keyTakeaways?.length > 0 && (
        <div className="mb-5">
          <h3 className="text-sm font-semibold mb-2">Key Takeaways</h3>
          <ol className="space-y-1.5 list-decimal list-inside text-sm text-gray-800">
            {s.keyTakeaways.map((t, i) => <li key={i} className="leading-snug">{mdLinks(t)}</li>)}
          </ol>
        </div>
      )}

      {/* Action-Ideen */}
      {s.actionIdeas?.length > 0 && (
        <div className="mb-5">
          <h3 className="text-sm font-semibold mb-2">{L.actionIdeas}</h3>
          <div className="grid sm:grid-cols-3 gap-2">
            {s.actionIdeas.map((a, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-3">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ratingClass(a.rating)}`}>{a.rating}</span>
                <p className="text-xs text-gray-700 mt-1.5 leading-snug">{a.thesis}</p>
                {a.time_horizon_months != null && <p className="text-[10px] text-gray-400 mt-1">{L.horizon}: {a.time_horizon_months} {L.months}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Google Trends */}
      {s.googleTrends && (
        <div className="mb-5">
          <h3 className="text-sm font-semibold mb-1">Google Trends · {L.trend[s.googleTrends.trend_direction] ?? s.googleTrends.trend_direction}</h3>
          <p className="text-sm text-gray-800 leading-snug">{mdLinks(s.googleTrends.trend_summary)}</p>
        </div>
      )}

      {/* Contrarian Insights */}
      {s.contrarianInsights?.length > 0 && (
        <div className="mb-5">
          <h3 className="text-sm font-semibold mb-2">Contrarian Insights</h3>
          <ul className="space-y-1.5 text-sm text-gray-800 bg-[#CCFF00]/10 rounded-lg p-3">
            {s.contrarianInsights.map((c, i) => <li key={i} className="leading-snug">• {mdLinks(c)}</li>)}
          </ul>
        </div>
      )}

      {/* Quellen */}
      {s.sources?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-1">{L.sources} ({s.sources.length})</h3>
          <ul className="text-xs text-gray-500 space-y-0.5">
            {s.sources.slice(0, 12).map((src, i) => (
              <li key={i} className="truncate">
                <a href={src.startsWith('http') ? src : `https://${src}`} target="_blank" rel="noopener noreferrer" className="underline hover:text-black">{src}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
