/**
 * Types for the Premarket Syntheses API from stocks.app
 * @see premarket-api-integration.json for full API specification
 */

export type PremarketRating = 'BUY' | 'HOLD' | 'SELL'
export type TrendDirection = 'RISING' | 'STABLE' | 'DECLINING'

export interface PremarketActionIdea {
  rating: PremarketRating
  thesis: string
  time_horizon_months?: number
  risk_flags?: string[]
}

export interface PremarketGoogleTrends {
  trend_direction: TrendDirection
  trend_summary: string
  peak_interest_period: string
}

export interface PremarketSynthesis {
  rating: PremarketRating | null
  rationale: string | null
  keyTakeaways: string[]
  actionIdeas: PremarketActionIdea[]
  contrarianInsights: string[]
  googleTrends: PremarketGoogleTrends | null
  sources: string[]
  model: string | null
  updatedAt: string | null
}

export interface PremarketInstrument {
  isin: string
  name: string | null
  symbol: string | null
  currency: string
}

export interface PremarketCompany {
  id: string
  name: string
}

export interface PremarketItem {
  id: string
  instrumentId: string
  instrument: PremarketInstrument
  premarket: PremarketCompany
  latestPrice: number | null
  synthesis: PremarketSynthesis | null
}

export interface PremarketPagination {
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface PremarketApiResponse {
  ok: boolean
  data?: PremarketItem[]
  pagination?: PremarketPagination
  error?: string
}

export interface FetchPremarketOptions {
  search?: string
  isin?: string
  limit?: number
  offset?: number
  withSynthesis?: boolean
}
