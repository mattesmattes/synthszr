export type StockRating = 'BUY' | 'HOLD' | 'SELL'

export interface StockActionIdea {
  rating: StockRating
  thesis: string
  time_horizon_months?: number
  risk_flags?: string[]
}

export interface StockSynthszrResult {
  executive_summary: string
  key_takeaways: string[]
  action_ideas: StockActionIdea[]
  contrarian_insights: string[]
  sources: string[]
  final_recommendation: {
    rating: StockRating
    rationale: string
  }
  model?: string
  created_at?: string
}

export interface FetchStockSynthszrOptions {
  company: string
  currency?: string
  recencyDays?: number
  price?: number | null
}
