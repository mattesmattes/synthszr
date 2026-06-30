"use client"

import Image from "next/image"
import type { ThumbnailPortal } from "./types"
import type { ProductLinkData } from "@/lib/tiptap/dom-processors/product-links"

// Thumbnail-Hintergrund nach Produkt-Trend (statt Company-Vote):
// steigend = neongrün, stagnierend = cyan, fallend = rot.
const TREND_BG = { up: '#39FF14', flat: '#00FFFF', down: '#FF4D00' } as const

interface ArticleThumbnailPortalProps {
  portal: ThumbnailPortal
  productLinks: ProductLinkData
  devicePixelRatio: number
}

export function ArticleThumbnailPortal({
  portal,
  productLinks,
  devicePixelRatio,
}: ArticleThumbnailPortalProps) {
  const { thumbnail, h2Element } = portal

  // Abschnittstext (von dieser H2 bis zur nächsten H2) einsammeln.
  let sectionText = h2Element.textContent || ''
  let el: Element | null = h2Element.nextElementSibling
  while (el && el.tagName !== 'H2') {
    sectionText += ' ' + (el.textContent || '')
    el = el.nextElementSibling
  }

  // Prominentestes genanntes Chart-Produkt (höchster Score) bestimmt die Farbe.
  let topTrend: 'up' | 'down' | 'flat' = 'flat'
  let topScore = -1
  for (const entry of productLinks.values()) {
    const escaped = entry.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(sectionText) && entry.score > topScore) {
      topScore = entry.score
      topTrend = entry.trend ?? 'flat'
    }
  }

  const bgColor = TREND_BG[topTrend]
  const displaySize = Math.round(604 / devicePixelRatio)

  return (
    <div
      className="rounded-full overflow-hidden mx-auto bg-neon-pulse"
      style={{ width: displaySize, height: displaySize, backgroundColor: bgColor }}
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
