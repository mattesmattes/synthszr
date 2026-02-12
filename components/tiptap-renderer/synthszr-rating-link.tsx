"use client"

import { useState } from "react"
import { StockSynthszrLayer } from "../stock-synthszr-layer"
import { StockQuotePopover } from "../stock-quote-popover"
import {
  RATING_BADGE_STYLES,
  RATING_LABELS,
  DIRECTION_STYLES,
  DIRECTION_ARROWS,
} from "@/lib/synthszr/rating-styles"
import type { SynthszrRatingLinkProps } from "./types"

export function SynthszrRatingLink({ company, displayName, rating, ticker, changePercent, direction, isFirst }: SynthszrRatingLinkProps) {
  const [showSynthszr, setShowSynthszr] = useState(false)
  const [showQuote, setShowQuote] = useState(false)

  const hasQuoteData = ticker && typeof changePercent === 'number'

  return (
    <>
      <span className="inline-flex items-baseline gap-1 text-foreground text-[13px]">
        {isFirst && <span className="font-bold uppercase text-[0.8125em]">Synthszr Vote:</span>}
        {!isFirst && <span>,</span>}
        <span
          onClick={hasQuoteData ? () => setShowQuote(true) : undefined}
          className={`ml-1 ${hasQuoteData ? 'hover:underline cursor-pointer' : ''}`}
        >
          {displayName}
          {ticker && <span className="text-muted-foreground"> ({ticker})</span>}
          {typeof changePercent === 'number' && direction && (
            <span className={`ml-1 px-1 py-0.5 rounded text-xs font-bold ${DIRECTION_STYLES[direction]}`}>
              {DIRECTION_ARROWS[direction]}{Math.abs(changePercent).toFixed(1)}%
            </span>
          )}
        </span>
        <span
          onClick={() => setShowSynthszr(true)}
          className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold not-italic cursor-pointer hover:opacity-80 ${RATING_BADGE_STYLES[rating]}`}
        >
          {RATING_LABELS[rating]}
        </span>
      </span>
      {showSynthszr && (
        <StockSynthszrLayer
          company={company}
          onClose={() => setShowSynthszr(false)}
        />
      )}
      {showQuote && (
        <StockQuotePopover
          company={company}
          onClose={() => setShowQuote(false)}
        />
      )}
    </>
  )
}
