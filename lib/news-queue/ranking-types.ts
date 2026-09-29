// lib/news-queue/ranking-types.ts

/** One ranking suggestion (from generateRankingSuggestions in ranking-service.ts). */
export interface RankedSuggestion {
  queueItemId: string
  rank: number
  reason: string
  confidence: number
}

export type UserAction = 'pending' | 'accepted' | 'rejected' | 'added' | 'reordered'
