"use client"

import { useState } from "react"
import { ExternalLink } from "lucide-react"
import { PremarketSynthszrLayer } from "../premarket-synthszr-layer"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { trackEvent } from "@/lib/analytics/tracker"
import { RATING_BADGE_STYLES, RATING_LABELS } from "@/lib/synthszr/rating-styles"
import type { PremarketRatingLinkProps } from "./types"

export function PremarketRatingLink({ company, displayName, rating, isFirst, isin }: PremarketRatingLinkProps) {
  const [showPremarket, setShowPremarket] = useState(false)

  return (
    <>
      <button
        onClick={() => { trackEvent('synthszr_vote_click', { company }); setShowPremarket(true) }}
        className="inline-flex items-baseline gap-1 hover:underline cursor-pointer text-foreground text-[13px]"
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {isFirst ? (
                <span><span className="font-bold uppercase text-[0.8125em]">Synthszr Vote:</span> {displayName}</span>
              ) : (
                <span>, {displayName}</span>
              )}
            </TooltipTrigger>
            <TooltipContent>
              <p>Click for the detailed SYNTHSZR analysis</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold not-italic ${RATING_BADGE_STYLES[rating]}`}>
                {RATING_LABELS[rating]}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Click for the detailed SYNTHSZR analysis</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground hover:text-foreground transition-colors">
                <ExternalLink className="h-3 w-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Click for the detailed SYNTHSZR analysis</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </button>
      {showPremarket && (
        <PremarketSynthszrLayer
          company={company}
          isin={isin}
          onClose={() => setShowPremarket(false)}
        />
      )}
    </>
  )
}
