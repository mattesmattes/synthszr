'use client'

import { useState } from 'react'
import Link from 'next/link'
import { SynthszrBadge } from './synthszr-badge'
import { StockSynthszrLayer } from './stock-synthszr-layer'
import { StockQuotePopover } from './stock-quote-popover'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type Rating = 'BUY' | 'HOLD' | 'SELL'

export interface CompanyCardData {
  name: string
  slug: string
  type: 'public' | 'premarket'
  mentionCount: number
  // Rating data (fetched separately)
  rating?: Rating | null
  ticker?: string | null
  changePercent?: number | null
  direction?: 'up' | 'down' | 'neutral' | null
  isin?: string
}

interface CompanyCardProps {
  company: CompanyCardData
  className?: string
  locale?: string
}

const directionStyles = {
  up: 'bg-[#39FF14] text-black',
  down: 'bg-[#FF6600] text-black',
  neutral: 'bg-gray-300 text-black',
}

const directionArrows = {
  up: '↑',
  down: '↓',
  neutral: '→',
}

const translations: Record<string, Record<string, string>> = {
  de: { article: 'Artikel', articles: 'Artikel', analyse: 'Analyse', premarket: 'Premarket' },
  en: { article: 'Article', articles: 'Articles', analyse: 'Analyse', premarket: 'Premarket' },
  nds: { article: 'Artikel', articles: 'Artikels', analyse: 'Analyse', premarket: 'Premarket' },
  cs: { article: 'Článek', articles: 'Článků', analyse: 'Analýza', premarket: 'Premarket' },
}

/**
 * Card component for displaying a company in the companies list
 *
 * Shows: Company name, ticker, percentage change, rating badge, news count link
 */
export function CompanyCard({ company, className, locale = 'de' }: CompanyCardProps) {
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [showQuote, setShowQuote] = useState(false)
  const t = translations[locale] || translations.de

  const hasRating = company.rating != null
  const hasQuoteData = company.type === 'public' && company.ticker && typeof company.changePercent === 'number'

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 py-3 border-b border-border last:border-b-0',
        className
      )}
    >
      {/* Left side: Company info + badge */}
      <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
        {hasRating ? (
          <SynthszrBadge
            company={company.slug}
            displayName={company.name}
            rating={company.rating!}
            type={company.type}
            ticker={company.ticker}
            changePercent={company.changePercent}
            direction={company.direction}
            isin={company.isin}
            showName={true}
            size="md"
          />
        ) : (
          <>
            {/* Company name - clickable for quote if public */}
            <span
              onClick={company.type === 'public' ? () => setShowQuote(true) : undefined}
              className={cn(
                'text-sm font-medium',
                company.type === 'public' && 'hover:underline cursor-pointer'
              )}
            >
              {company.name}
              {company.ticker && (
                <span className="text-muted-foreground ml-0.5">({company.ticker})</span>
              )}
            </span>

            {/* Percentage change badge */}
            {hasQuoteData && company.direction && (
              <span className={cn(
                'px-1 py-0.5 rounded text-[11px] font-bold',
                directionStyles[company.direction]
              )}>
                {directionArrows[company.direction]}{Math.abs(company.changePercent!).toFixed(1)}%
              </span>
            )}

            {/* Generate rating button for public companies without rating */}
            {company.type === 'public' && (
              <button
                onClick={() => setShowAnalysis(true)}
                className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
              >
                {t.analyse}
              </button>
            )}

            {company.type === 'premarket' && (
              <span className="text-xs text-muted-foreground">({t.premarket})</span>
            )}
          </>
        )}
      </div>

      {/* Right side: News count link */}
      <Link
        href={locale && locale !== 'de' ? `/${locale}/companies/${company.slug}` : `/companies/${company.slug}`}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
      >
        <span>{company.mentionCount} {company.mentionCount === 1 ? t.article : t.articles}</span>
        <ArrowRight className="h-3 w-3" />
      </Link>

      {/* Dialogs */}
      {showAnalysis && (
        <StockSynthszrLayer
          company={company.slug}
          onClose={() => setShowAnalysis(false)}
        />
      )}
      {showQuote && (
        <StockQuotePopover
          company={company.slug}
          onClose={() => setShowQuote(false)}
        />
      )}
    </div>
  )
}

/**
 * Skeleton loader for CompanyCard
 */
export function CompanyCardSkeleton() {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border">
      <div className="flex items-center gap-3">
        <div className="h-4 w-24 bg-muted animate-pulse rounded" />
        <div className="h-5 w-10 bg-muted animate-pulse rounded" />
      </div>
      <div className="h-4 w-16 bg-muted animate-pulse rounded" />
    </div>
  )
}
