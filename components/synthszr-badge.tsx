'use client'

import { useState } from 'react'
import { StockSynthszrLayer } from './stock-synthszr-layer'
import { StockQuotePopover } from './stock-quote-popover'
import { PremarketSynthszrLayer } from './premarket-synthszr-layer'
import { cn } from '@/lib/utils'

type Rating = 'BUY' | 'HOLD' | 'SELL'

interface SynthszrBadgeProps {
  /** Company API slug (e.g., 'apple', 'anysphere') */
  company: string
  /** Display name for the company */
  displayName: string
  /** The rating to display */
  rating: Rating
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

const ratingStyles = {
  BUY: 'bg-[#39FF14] text-black',      // Neon Green
  HOLD: 'bg-gray-300 dark:bg-gray-500 text-black dark:text-white',  // Gray
  SELL: 'bg-[#FF6600] text-black',     // Neon Orange
}

const ratingLabels = {
  BUY: 'Buy',
  HOLD: 'Hold',
  SELL: 'Sell',
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
                directionStyles[direction]
              )}>
                {directionArrows[direction]}{Math.abs(changePercent).toFixed(1)}%
              </span>
            )}
          </span>
        )}
        <button
          onClick={handleBadgeClick}
          className={cn(
            'font-bold rounded not-italic cursor-pointer hover:opacity-80 transition-opacity',
            sizeClasses,
            ratingStyles[rating]
          )}
        >
          {ratingLabels[rating]}
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
