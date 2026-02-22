'use client'

import { useState } from 'react'
import { StockSynthszrLayer } from './stock-synthszr-layer'
import { StockQuotePopover } from './stock-quote-popover'
import { PremarketSynthszrLayer } from './premarket-synthszr-layer'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  RATING_BADGE_STYLES,
  RATING_LABELS,
  DIRECTION_STYLES,
  DIRECTION_ARROWS,
} from '@/lib/synthszr/rating-styles'
import type { StockRating } from '@/lib/stock-synthszr/types'

interface SynthszrBadgeProps {
  /** Company API slug (e.g., 'apple', 'anysphere') */
  company: string
  /** Display name for the company */
  displayName: string
  /** The rating to display */
  rating: StockRating
  /** Company type */
  type: 'public' | 'premarket'
  /** Stock ticker symbol (for public companies) */
  ticker?: string | null
  /** Daily change percentage (for public companies) */
  changePercent?: number | null
  /** Change direction (for public companies) */
  direction?: 'up' | 'down' | 'neutral' | null
  /** ISIN for premarket companies */
  isin?: string
  /** Show company name alongside badge */
  showName?: boolean
  /** Size variant */
  size?: 'sm' | 'md'
  /** Additional CSS classes */
  className?: string
}

/**
 * Reusable Synthszr rating badge component
 *
 * Displays BUY/HOLD/SELL badges with consistent styling.
 * Clicking opens the full analysis dialog.
 */
export function SynthszrBadge({
  company,
  displayName,
  rating,
  type,
  ticker,
  changePercent,
  direction,
  isin,
  showName = true,
  size = 'md',
  className,
}: SynthszrBadgeProps) {
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [showQuote, setShowQuote] = useState(false)
  const [showPremarket, setShowPremarket] = useState(false)

  const hasQuoteData = type === 'public' && ticker && typeof changePercent === 'number'
  const sizeClasses = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-xs px-2 py-1'
  const nameSizeClasses = size === 'sm' ? 'text-xs' : 'text-sm'

  const handleBadgeClick = () => {
    if (type === 'premarket') {
      setShowPremarket(true)
    } else {
      setShowAnalysis(true)
    }
  }

  return (
    <>
      <span className={cn('inline-flex items-center gap-1.5', className)}>
        {showName && (
          <span
            onClick={hasQuoteData ? () => setShowQuote(true) : undefined}
            className={cn(
              nameSizeClasses,
              hasQuoteData && 'hover:underline cursor-pointer'
            )}
          >
            {displayName}
            {ticker && (
              <span className="text-muted-foreground ml-0.5">({ticker})</span>
            )}
            {hasQuoteData && direction && (
              <span className={cn(
                'ml-1 px-1 py-0.5 rounded text-[11px] font-bold',
                DIRECTION_STYLES[direction]
              )}>
                {DIRECTION_ARROWS[direction]}{Math.abs(changePercent).toFixed(1)}%
              </span>
            )}
          </span>
        )}
        <span className="text-muted-foreground text-xs">— Synthszr Vote:</span>
        <button
          onClick={handleBadgeClick}
          className={cn(
            'font-bold rounded not-italic cursor-pointer hover:opacity-80 transition-opacity',
            sizeClasses,
            RATING_BADGE_STYLES[rating]
          )}
        >
          {RATING_LABELS[rating]}
        </button>
        <button
          onClick={handleBadgeClick}
          className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          aria-label="Analyse öffnen"
        >
          <ExternalLink className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </button>
      </span>

      {/* Analysis Dialogs */}
      {showAnalysis && type === 'public' && (
        <StockSynthszrLayer
          company={company}
          onClose={() => setShowAnalysis(false)}
        />
      )}

      {showQuote && type === 'public' && (
        <StockQuotePopover
          company={company}
          onClose={() => setShowQuote(false)}
        />
      )}

      {showPremarket && type === 'premarket' && (
        <PremarketSynthszrLayer
          company={company}
          isin={isin}
          onClose={() => setShowPremarket(false)}
        />
      )}
    </>
  )
}
