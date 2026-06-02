// lib/news-queue/ranking-types.ts

/** A candidate item entering the ranking pipeline. */
export interface RankingCandidate {
  queueItemId: string
  title: string
  excerpt: string | null
  source: string | null
  totalScore: number
  winnerSimilarity: number // 0 when no winner match
}

/** One LLM suggestion produced by the reranker. */
export interface RankedSuggestion {
  queueItemId: string
  rank: number
  reason: string
  confidence: number
}

/** A positive/negative example for the few-shot block. */
export interface LabelExample {
  title: string
  source: string | null
}

export type UserAction = 'pending' | 'accepted' | 'rejected' | 'added' | 'reordered'
