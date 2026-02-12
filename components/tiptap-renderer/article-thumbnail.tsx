"use client"

import Image from "next/image"
import { VOTE_BG_CLASSES, VOTE_PRIORITY } from "@/lib/synthszr/rating-styles"
import type { PublicPortal, PremarketPortal, ThumbnailPortal } from "./types"

interface ArticleThumbnailPortalProps {
  portal: ThumbnailPortal
  ratingPortals: PublicPortal[]
  premarketRatingPortals: PremarketPortal[]
  devicePixelRatio: number
}

export function ArticleThumbnailPortal({
  portal,
  ratingPortals,
  premarketRatingPortals,
  devicePixelRatio,
}: ArticleThumbnailPortalProps) {
  const { thumbnail, h2Element } = portal

  // Find next H2 to define article section boundary
  let nextH2: Element | null = h2Element.nextElementSibling
  while (nextH2 && nextH2.tagName !== 'H2') {
    nextH2 = nextH2.nextElementSibling
  }

  // Collect all ratings in this article section
  const allRatings = [...ratingPortals, ...premarketRatingPortals]
  let bestVote: 'BUY' | 'HOLD' | 'SELL' | null = null

  for (const ratingPortal of allRatings) {
    const el = ratingPortal.element
    if (h2Element.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
      if (!nextH2 || nextH2.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) {
        const rating = ratingPortal.rating
        if (!bestVote || VOTE_PRIORITY[rating] > VOTE_PRIORITY[bestVote]) {
          bestVote = rating
        }
      }
    }
  }

  const bgClass = bestVote ? VOTE_BG_CLASSES[bestVote] : VOTE_BG_CLASSES['NONE']
  const displaySize = Math.round(604 / devicePixelRatio)

  return (
    <div
      className={`rounded-full overflow-hidden mx-auto ${bgClass} bg-neon-pulse`}
      style={{ width: displaySize, height: displaySize }}
    >
      <Image
        src={thumbnail.image_url}
        alt={`Article ${thumbnail.article_index + 1} thumbnail`}
        width={displaySize}
        height={displaySize}
        unoptimized
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  )
}
