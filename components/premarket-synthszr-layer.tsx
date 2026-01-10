'use client'

import { useEffect, useState } from 'react'
import {
  X,
  RefreshCcw,
  TrendingUp,
  Minus,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
} from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'
import type { PremarketItem, PremarketSynthesis } from '@/lib/premarket/types'

interface PremarketSynthszrLayerProps {
  /** Search term for the company */
  company: string
  /** ISIN if known */
  isin?: string
  onClose: () => void
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: PremarketItem }

export function PremarketSynthszrLayer({
  company,
  isin,
  onClose,
}: PremarketSynthszrLayerProps) {
  const [state, setState] = useState<FetchState>({ status: 'loading' })

  useEffect(() => {
    if (!company && !isin) return
    const controller = new AbortController()
    setState({ status: 'loading' })

    ;(async () => {
      try {
        const params = new URLSearchParams()
        if (isin) {
          params.set('isin', isin)
        } else {
          params.set('search', company)
        }
        params.set('withSynthesis', 'true')
        params.set('limit', '1')

        const response = await fetch(`/api/premarket?${params}`, {
          credentials: 'include',
          signal: controller.signal,
        })
        const json = await response.json()

        if (!response.ok || !json?.ok) {
          throw new Error(json?.error ?? 'Premarket-Synthszr konnte nicht geladen werden.')
        }

        if (!json.data || json.data.length === 0) {
          throw new Error('Kein Premarket-Instrument gefunden.')
        }

        setState({ status: 'success', data: json.data[0] })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Premarket-Synthszr konnte nicht geladen werden.',
        })
      }
    })()

    return () => {
      controller.abort()
    }
  }, [company, isin])

  const displayTitle = state.status === 'success'
    ? state.data.instrument.name || state.data.premarket.name
    : company.toUpperCase()

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-0 backdrop-blur-md md:p-4">
      <div className="relative flex h-full w-full flex-col overflow-hidden border-border bg-background shadow-2xl md:h-[90vh] md:max-w-5xl md:rounded-xl md:border">
        {/* Close button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Modal schließen"
          className="absolute right-2 top-2 z-10"
        >
          <X className="h-5 w-5" />
        </Button>

        {/* Header */}
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 pr-12 md:flex-row md:items-center md:justify-between md:px-6 md:py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
              Premarket-Synthszr
            </p>
            <h2 className="truncate text-base font-semibold md:text-lg">
              {displayTitle}
            </h2>
            {state.status === 'success' && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                {state.data.instrument.symbol && (
                  <span className="font-mono">{state.data.instrument.symbol}</span>
                )}
                <span className="font-mono">{state.data.instrument.isin}</span>
                <span className="text-muted-foreground">•</span>
                <span>{state.data.premarket.name}</span>
                {state.data.latestPrice !== null && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <span>
                      {state.data.latestPrice.toLocaleString('de-DE', {
                        style: 'currency',
                        currency: state.data.instrument.currency || 'USD',
                      })}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {state.status === 'success' && state.data.synthesis?.updatedAt && (
              <div className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span>
                  Aktualisiert am {new Date(state.data.synthesis.updatedAt).toLocaleDateString('de-DE', {
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
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-muted/30 p-4 md:p-6">
          {state.status === 'loading' && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <RefreshCcw className="h-5 w-5 animate-spin mr-2" />
              Lade Premarket-Synthszr …
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
          {state.status === 'success' && state.data.synthesis && (
            <PremarketSynthesisContent synthesis={state.data.synthesis} />
          )}
          {state.status === 'success' && !state.data.synthesis && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              <TrendingUp className="h-12 w-12 opacity-20" />
              <p>Keine AI-Synthese für dieses Instrument verfügbar.</p>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Schließen
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PremarketSynthesisContent({ synthesis }: { synthesis: PremarketSynthesis }) {
  const TrendIcon = {
    RISING: ArrowUpRight,
    STABLE: Minus,
    DECLINING: ArrowDownRight,
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Final Recommendation */}
      {synthesis.rating && (
        <section>
          <header className="mb-3">
            <h3 className="text-base font-semibold">Synthszr Vote</h3>
          </header>
          <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-3 text-sm font-semibold uppercase tracking-wide">
              <span
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-bold',
                  synthesis.rating === 'BUY' && 'bg-[#39FF14] text-black',
                  synthesis.rating === 'SELL' && 'bg-[#FF6600] text-black',
                  synthesis.rating === 'HOLD' && 'bg-gray-300 dark:bg-gray-500 text-black dark:text-white'
                )}
              >
                {synthesis.rating}
              </span>
              <span>Empfehlung</span>
            </div>
            {synthesis.rationale && (
              <p className="text-sm leading-relaxed">{synthesis.rationale}</p>
            )}
          </div>
        </section>
      )}

      {/* Key Takeaways */}
      {synthesis.keyTakeaways.length > 0 && (
        <section>
          <header className="mb-3">
            <h3 className="text-base font-semibold">Key Takeaways</h3>
          </header>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {synthesis.keyTakeaways.map((item, index) => (
              <li key={`takeaway-${index}`} className="leading-relaxed">
                {item}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Action Ideas */}
      {synthesis.actionIdeas.length > 0 && (
        <section>
          <header className="mb-3">
            <h3 className="text-base font-semibold">Action-Ideen</h3>
            <p className="text-xs text-muted-foreground">Bewertung + Zeitfenster + Risiken</p>
          </header>
          <div className="grid gap-4 md:grid-cols-3">
            {synthesis.actionIdeas.map((idea, index) => (
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
                        className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground"
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
      )}

      {/* Google Trends */}
      {synthesis.googleTrends && (
        <section>
          <header className="mb-3">
            <h3 className="text-base font-semibold">Google Trends</h3>
          </header>
          <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              {(() => {
                const Icon = TrendIcon[synthesis.googleTrends.trend_direction]
                return (
                  <Icon
                    className={cn(
                      'h-5 w-5',
                      synthesis.googleTrends.trend_direction === 'RISING' && 'text-green-600',
                      synthesis.googleTrends.trend_direction === 'DECLINING' && 'text-red-600',
                      synthesis.googleTrends.trend_direction === 'STABLE' && 'text-yellow-600'
                    )}
                  />
                )
              })()}
              <span className="font-medium">{synthesis.googleTrends.trend_direction}</span>
            </div>
            <p className="text-sm leading-relaxed">{synthesis.googleTrends.trend_summary}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Peak: {synthesis.googleTrends.peak_interest_period}
            </p>
          </div>
        </section>
      )}

      {/* Contrarian Insights */}
      {synthesis.contrarianInsights.length > 0 && (
        <section>
          <header className="mb-3">
            <h3 className="text-base font-semibold">Contrarian Insights</h3>
            <p className="text-xs text-muted-foreground">Perspektiven, die vom Konsens abweichen</p>
          </header>
          <ul className="space-y-2 rounded-lg border border-[#CCFF00]/30 bg-[#CCFF00]/10 p-4 text-sm leading-relaxed">
            {synthesis.contrarianInsights.map((insight, index) => (
              <li key={`contrarian-${index}`}>• {insight}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Sources */}
      {synthesis.sources && synthesis.sources.length > 0 && (
        <section>
          <header className="mb-3">
            <h3 className="text-base font-semibold">Quellen</h3>
            <p className="text-xs text-muted-foreground">{synthesis.sources.length} verwendete Quellen</p>
          </header>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {synthesis.sources.map((source, index) => (
              <li key={`source-${index}`} className="truncate">
                <a
                  href={source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  {source.replace(/^https?:\/\//, '').slice(0, 60)}
                  {source.length > 60 && '...'}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Model Info */}
      {synthesis.model && (
        <div className="text-xs text-muted-foreground">
          Generiert mit {synthesis.model}
        </div>
      )}

      {/* Legal Disclaimer */}
      <section className="mt-6 pt-4 border-t border-border">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          <strong>Rechtlicher Hinweis:</strong> Diese Analyse wurde vollständig durch künstliche Intelligenz (KI) erstellt
          und stellt <strong>keine Anlageberatung</strong> dar. Die dargestellten Informationen, Bewertungen und
          Empfehlungen dienen ausschließlich zu Informationszwecken und ersetzen keine professionelle Finanzberatung.
          Der Betreiber übernimmt <strong>keine Haftung</strong> für Entscheidungen, die auf Grundlage dieser
          KI-generierten Inhalte getroffen werden. Premarket-Investments sind mit erhöhten Risiken verbunden.
          Anlageentscheidungen sollten stets unter Berücksichtigung der persönlichen finanziellen Situation und nach
          Rücksprache mit einem qualifizierten Finanzberater getroffen werden.
          {' '}
          <a href="/impressum" className="underline hover:text-foreground">
            Impressum & Betreiberangaben
          </a>
        </p>
      </section>
    </div>
  )
}
