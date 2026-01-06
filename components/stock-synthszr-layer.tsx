'use client'

import { useEffect, useState } from 'react'
import { X, RefreshCcw, TrendingUp, TrendingDown, Minus, Calendar } from 'lucide-react'
import type { StockSynthszrResult } from '@/lib/stock-synthszr/types'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'

interface StockSynthszrLayerProps {
  company: string
  currency?: string
  price?: number | null
  changePercent?: number | null
  onClose: () => void
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: StockSynthszrResult }

const DEFAULT_RECENCY_DAYS = 90

export function StockSynthszrLayer({
  company,
  currency = 'EUR',
  price,
  changePercent,
  onClose,
}: StockSynthszrLayerProps) {
  const [state, setState] = useState<FetchState>({ status: 'loading' })

  useEffect(() => {
    if (!company) return
    const controller = new AbortController()
    setState({ status: 'loading' })

    ;(async () => {
      try {
        const response = await fetch('/api/stock-synthszr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company,
            currency,
            price,
          }),
          signal: controller.signal,
        })
        const json = await response.json()
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error ?? 'Stock-Synthszr konnte nicht erstellt werden.')
        }
        setState({ status: 'success', data: json.data })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Stock-Synthszr konnte nicht erstellt werden.',
        })
      }
    })()

    return () => {
      controller.abort()
    }
  }, [company, currency, price])

  const resolvedModelLabel =
    state.status === 'success'
      ? state.data.model?.toUpperCase() || 'AI'
      : null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-0 backdrop-blur-md md:p-4">
      <div className="relative flex h-full w-full flex-col overflow-hidden border-border bg-background shadow-2xl md:h-[90vh] md:max-w-5xl md:rounded-xl md:border">
        {/* Header */}
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6 md:py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
              Stock-Synthszr
              {resolvedModelLabel ? ` (${resolvedModelLabel})` : null}
            </p>
            <h2 className="truncate text-base font-semibold md:text-lg">
              {company}
            </h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {typeof price === 'number' && Number.isFinite(price) && (
                <span>
                  {price.toLocaleString('de-DE', { style: 'currency', currency })}
                </span>
              )}
              {typeof changePercent === 'number' && (
                <span className={cn(
                  'flex items-center gap-0.5',
                  changePercent > 0.5 && 'text-green-600',
                  changePercent < -0.5 && 'text-red-600'
                )}>
                  {changePercent > 0.5 ? <TrendingUp className="h-3 w-3" /> :
                   changePercent < -0.5 ? <TrendingDown className="h-3 w-3" /> :
                   <Minus className="h-3 w-3" />}
                  {changePercent > 0 ? '+' : ''}{changePercent.toFixed(1)}%
                </span>
              )}
              <span>· Zeitfenster {DEFAULT_RECENCY_DAYS} Tage</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {state.status === 'success' && state.data.created_at && (
              <div className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span>
                  Erstellt am {new Date(state.data.created_at).toLocaleDateString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })}
                </span>
              </div>
            )}
            {state.status === 'loading' && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCcw className="h-4 w-4 animate-spin" />
              </div>
            )}
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Modal schließen">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-muted/30 p-4 md:p-6">
          {state.status === 'loading' && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <RefreshCcw className="h-5 w-5 animate-spin mr-2" />
              AI erstellt Stock-Synthszr …
            </div>
          )}
          {state.status === 'error' && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-destructive">
              <p>{state.message}</p>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Schließen
              </Button>
            </div>
          )}
          {state.status === 'success' && <SynthesisContent data={state.data} />}
        </div>
      </div>
    </div>
  )
}

function SynthesisContent({ data }: { data: StockSynthszrResult }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Key Takeaways */}
      <section>
        <header className="mb-3">
          <h3 className="text-base font-semibold">Key Takeaways</h3>
          <p className="text-xs text-muted-foreground">Direkt vom Modell recherchiert (5 Fakten)</p>
        </header>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {data.key_takeaways.map((item, index) => (
            <li key={`takeaway-${index}`} className="leading-relaxed">
              {item}
            </li>
          ))}
        </ol>
      </section>

      {/* Action Ideas */}
      <section>
        <header className="mb-3">
          <h3 className="text-base font-semibold">Action-Ideen</h3>
          <p className="text-xs text-muted-foreground">Bewertung + Zeitfenster + Risiken</p>
        </header>
        <div className="grid gap-4 md:grid-cols-3">
          {data.action_ideas.map((idea, index) => (
            <article
              key={`action-${index}`}
              className="rounded-lg border border-border bg-background p-4 shadow-sm"
            >
              <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
                <span>Idee {index + 1}</span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-bold',
                    idea.rating === 'BUY' && 'bg-[#39FF14] text-black',
                    idea.rating === 'SELL' && 'bg-[#FF6600] text-black',
                    idea.rating === 'HOLD' && 'bg-gray-300 dark:bg-gray-500 text-black dark:text-white'
                  )}
                >
                  {idea.rating}
                </span>
              </div>
              <p className="text-sm leading-relaxed">{idea.thesis}</p>
              {typeof idea.time_horizon_months === 'number' && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Zeithorizont: {idea.time_horizon_months} {idea.time_horizon_months === 1 ? 'Monat' : 'Monate'}
                </p>
              )}
              {Array.isArray(idea.risk_flags) && idea.risk_flags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {idea.risk_flags.map((flag, flagIndex) => (
                    <span
                      key={`risk-${index}-${flagIndex}`}
                      className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {flag}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* Final Recommendation */}
      <section>
        <header className="mb-3">
          <h3 className="text-base font-semibold">Gesamtfazit</h3>
          <p className="text-xs text-muted-foreground">Abschließende Empfehlung des Modells</p>
        </header>
        <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-3 text-sm font-semibold uppercase tracking-wide">
            <span
              className={cn(
                'rounded-full px-3 py-1 text-xs font-bold',
                data.final_recommendation.rating === 'BUY' && 'bg-[#39FF14] text-black',
                data.final_recommendation.rating === 'SELL' && 'bg-[#FF6600] text-black',
                data.final_recommendation.rating === 'HOLD' && 'bg-gray-300 dark:bg-gray-500 text-black dark:text-white'
              )}
            >
              {data.final_recommendation.rating}
            </span>
            <span>Empfehlung</span>
          </div>
          <p className="text-sm leading-relaxed">{data.final_recommendation.rationale}</p>
        </div>
      </section>

      {/* Contrarian Insights */}
      <section>
        <header className="mb-3">
          <h3 className="text-base font-semibold">Contrarian Insights</h3>
          <p className="text-xs text-muted-foreground">2 Perspektiven, die vom Konsens abweichen</p>
        </header>
        <ul className="space-y-2 rounded-lg border border-[#CCFF00]/30 bg-[#CCFF00]/10 p-4 text-sm leading-relaxed">
          {data.contrarian_insights.map((insight, index) => (
            <li key={`contrarian-${index}`}>• {insight}</li>
          ))}
        </ul>
      </section>

      {/* Sources */}
      {data.sources && data.sources.length > 0 && (
        <section>
          <header className="mb-3">
            <h3 className="text-base font-semibold">Quellen</h3>
            <p className="text-xs text-muted-foreground">{data.sources.length} verwendete Quellen</p>
          </header>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {data.sources.map((source, index) => (
              <li key={`source-${index}`} className="truncate">
                <a
                  href={source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary hover:underline"
                >
                  {source}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Legal Disclaimer */}
      <section className="mt-6 pt-4 border-t border-border">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          <strong>Rechtlicher Hinweis:</strong> Diese Analyse wurde vollständig durch künstliche Intelligenz (KI) erstellt
          und stellt <strong>keine Anlageberatung</strong> dar. Die dargestellten Informationen, Bewertungen und
          Empfehlungen dienen ausschließlich zu Informationszwecken und ersetzen keine professionelle Finanzberatung.
          Der Betreiber übernimmt <strong>keine Haftung</strong> für Entscheidungen, die auf Grundlage dieser
          KI-generierten Inhalte getroffen werden. Anlageentscheidungen sollten stets unter Berücksichtigung der
          persönlichen finanziellen Situation und nach Rücksprache mit einem qualifizierten Finanzberater getroffen werden.
          {' '}
          <a
            href="/impressum"
            className="underline hover:text-foreground"
          >
            Impressum & Betreiberangaben
          </a>
        </p>
      </section>
    </div>
  )
}
