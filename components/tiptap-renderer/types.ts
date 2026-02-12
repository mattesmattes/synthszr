// Shared types for the TiptapRenderer component family

export type { PublicPortal, PremarketPortal, BatchQuoteResult, PremarketRatingResult } from '@/lib/tiptap/dom-processors/rating-links'
export type { ArticleThumbnail, ThumbnailPortal } from '@/lib/tiptap/dom-processors/news-headings'

export interface TiptapRendererProps {
  content: Record<string, unknown>
  postId?: string
  queueItemIds?: string[]
  originalContent?: Record<string, unknown>
}

export interface SynthszrRatingLinkProps {
  company: string
  displayName: string
  rating: 'BUY' | 'HOLD' | 'SELL'
  ticker?: string
  changePercent?: number
  direction?: 'up' | 'down' | 'neutral'
  isFirst: boolean
}

export interface PremarketRatingLinkProps {
  company: string
  displayName: string
  rating: 'BUY' | 'HOLD' | 'SELL'
  isFirst: boolean
  isin?: string
}
