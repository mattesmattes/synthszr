'use client'

import { useState } from 'react'
import Link from 'next/link'
import { StockSynthszrLayer } from './stock-synthszr-layer'
import { StockQuotePopover } from './stock-quote-popover'
import { PremarketSynthszrLayer } from './premarket-synthszr-layer'
import { cn } from '@/lib/utils'

type Rating = 'BUY' | 'HOLD' | 'SELL'

export interface CompanyCardData {
  name: string
  slug: string
  type: 'public' | 'premarket'
  mentionCount: number
  rating?: Rating | null
  ticker?: string | null
  changePercent?: number | null
  direction?: 'up' | 'down' | 'neutral' | null
  isin?: string
}

interface CompanyTableRowProps {
  company: CompanyCardData
  locale?: string
}

const ratingStyles = {
  BUY: 'bg-[#39FF14] text-black',
  HOLD: 'bg-[#00FFFF] text-black',
  SELL: 'bg-[#FF6600] text-black',
}

const ratingLabels = {
  BUY: 'Buy',
  HOLD: 'Hold',
  SELL: 'Sell',
}

const directionStyles = {
  up: 'text-[#39FF14]',
  down: 'text-[#FF6600]',
  neutral: 'text-muted-foreground',
}

const directionArrows = {
  up: '↑',
  down: '↓',
  neutral: '→',
}

const articlesTranslations: Record<string, { singular: string; plural: string }> = {
  de: { singular: 'Artikel', plural: 'Artikel' },
  en: { singular: 'article', plural: 'articles' },
  nds: { singular: 'Artikel', plural: 'Artikels' },
  cs: { singular: 'článek', plural: 'článků' },
}

/**
 * Table row component for the companies list
 */
export function CompanyTableRow({ company, locale = 'de' }: CompanyTableRowProps) {
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [showQuote, setShowQuote] = useState(false)
  const [showPremarket, setShowPremarket] = useState(false)

  const hasQuoteData = company.type === 'public' && company.ticker && typeof company.changePercent === 'number'
  const t = articlesTranslations[locale] || articlesTranslations.de

  const handleBadgeClick = () => {
    if (company.type === 'premarket') {
      setShowPremarket(true)
    } else {
      setShowAnalysis(true)
    }
  }

  const companyHref = locale === 'de'
    ? `/companies/${company.slug}`
    : `/${locale}/companies/${company.slug}`

  return (
    <>
      <tr className="border-b border-border hover:bg-muted/30 transition-colors">
        {/* Company Name */}
        <td className="py-3 px-4">
          <Link
            href={companyHref}
            className="font-medium hover:underline"
          >
            {company.name}
          </Link>
        </td>

        {/* Ticker + Change */}
        <td className="py-3 px-4">
          {company.type === 'public' && company.ticker ? (
            <span
              onClick={hasQuoteData ? () => setShowQuote(true) : undefined}
              className={cn(
                'text-sm',
                hasQuoteData && 'hover:underline cursor-pointer'
              )}
            >
              {company.ticker}
              {hasQuoteData && company.direction && (
                <span className={cn('ml-1 font-medium', directionStyles[company.direction])}>
                  {directionArrows[company.direction]}{Math.abs(company.changePercent!).toFixed(1)}%
                </span>
              )}
            </span>
          ) : company.type === 'premarket' ? (
            <span className="text-xs text-muted-foreground">Pre-IPO</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>

        {/* Synthszr Vote */}
        <td className="py-3 px-4">
          {company.rating ? (
            <button
              onClick={handleBadgeClick}
              className={cn(
                'text-xs font-bold px-2 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity',
                ratingStyles[company.rating]
              )}
            >
              {ratingLabels[company.rating]}
            </button>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          )}
        </td>

        {/* Article Count */}
        <td className="py-3 px-4 text-right">
          <Link
            href={companyHref}
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            {company.mentionCount} {company.mentionCount === 1 ? t.singular : t.plural}
          </Link>
        </td>
      </tr>

      {/* Dialogs */}
      {showAnalysis && company.type === 'public' && (
        <StockSynthszrLayer
          company={company.slug}
          onClose={() => setShowAnalysis(false)}
        />
      )}

      {showQuote && company.type === 'public' && (
        <StockQuotePopover
          company={company.slug}
          onClose={() => setShowQuote(false)}
        />
      )}

      {showPremarket && company.type === 'premarket' && (
        <PremarketSynthszrLayer
          company={company.slug}
          isin={company.isin}
          onClose={() => setShowPremarket(false)}
        />
      )}
    </>
  )
}

/**
 * Skeleton loader for table rows
 */
export function CompanyTableSkeleton() {
  return (
    <tr className="border-b border-border">
      <td className="py-3 px-4">
        <div className="h-5 w-32 bg-muted animate-pulse rounded" />
      </td>
      <td className="py-3 px-4">
        <div className="h-5 w-20 bg-muted animate-pulse rounded" />
      </td>
      <td className="py-3 px-4">
        <div className="h-6 w-12 bg-muted animate-pulse rounded" />
      </td>
      <td className="py-3 px-4 text-right">
        <div className="h-5 w-16 bg-muted animate-pulse rounded ml-auto" />
      </td>
    </tr>
  )
}
