import type { StockRating } from '@/lib/stock-synthszr/types'

// Shared badge style constants for Synthszr ratings
// Used by: tiptap-renderer, synthszr-badge, tiptap-to-html

export const RATING_BADGE_STYLES: Record<StockRating, string> = {
  BUY: 'bg-neon-green text-black',
  HOLD: 'bg-neon-yellow text-black',
  SELL: 'bg-neon-orange text-black',
}

export const RATING_LABELS: Record<StockRating, string> = {
  BUY: 'Buy',
  HOLD: 'Hold',
  SELL: 'Sell',
}

export const DIRECTION_STYLES: Record<'up' | 'down' | 'neutral', string> = {
  up: 'bg-neon-green text-black',
  down: 'bg-neon-orange text-black',
  neutral: 'bg-gray-300 text-black',
}

export const DIRECTION_ARROWS: Record<'up' | 'down' | 'neutral', string> = {
  up: '\u2191',
  down: '\u2193',
  neutral: '\u2192',
}

// Thumbnail background colors by vote type
export const VOTE_BG_CLASSES: Record<string, string> = {
  BUY: 'bg-neon-green',
  HOLD: 'bg-neon-yellow',
  SELL: 'bg-neon-orange',
  NONE: 'bg-neon-cyan',
}

export const VOTE_PRIORITY: Record<string, number> = {
  BUY: 3,
  HOLD: 2,
  SELL: 1,
}
