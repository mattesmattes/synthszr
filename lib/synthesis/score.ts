/**
 * Synthesis Candidate Scoring Service
 * Uses Claude Haiku for fast, cost-effective evaluation of synthesis candidates
 */

import Anthropic from '@anthropic-ai/sdk'
import { SimilarItem, daysBetween } from './search'

export type SynthesisType =
  | 'contradiction'
  | 'evolution'
  | 'cross_domain'
  | 'validation'
  | 'pattern'

export interface ScoredCandidate {
  sourceItem: {
    id: string
    title: string
    content: string
  }
  relatedItem: SimilarItem
  similarityScore: number
  originalityScore: number
  relevanceScore: number
  synthesisType: SynthesisType
  reasoning: string
  daysAgo: number
  totalScore: number
}

interface ScoreResponse {
  originality: number
  relevance: number
  type: SynthesisType
  reasoning: string
}

/**
 * Score a single synthesis candidate using Claude Haiku
 */
async function scoreCandidate(
  anthropic: Anthropic,
  currentNews: string,
  historicalNews: string,
  daysAgo: number,
  scoringPrompt: string
): Promise<ScoreResponse> {
  const prompt = scoringPrompt
    .replace('{current_news}', currentNews.slice(0, 2000))
    .replace('{historical_news}', historicalNews.slice(0, 2000))
    .replace('{days_ago}', String(daysAgo))

  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  })

  const text =
    response.content[0].type === 'text' ? response.content[0].text : ''

  // Parse structured response
  const originalityMatch = text.match(/ORIGINALITÄT:\s*(\d+)/i)
  const relevanceMatch = text.match(/RELEVANZ:\s*(\d+)/i)
  const typeMatch = text.match(
    /TYP:\s*(contradiction|evolution|cross_domain|validation|pattern)/i
  )
  const reasoningMatch = text.match(/BEGRÜNDUNG:\s*([\s\S]+?)(?:\n\n|$)/i)

  return {
    originality: originalityMatch ? parseInt(originalityMatch[1], 10) : 5,
    relevance: relevanceMatch ? parseInt(relevanceMatch[1], 10) : 5,
    type: (typeMatch?.[1]?.toLowerCase() as SynthesisType) || 'cross_domain',
    reasoning: reasoningMatch?.[1]?.trim() || 'Keine Begründung',
  }
}

/**
 * Score multiple synthesis candidates in parallel
 * Returns sorted by total score (originality + relevance)
 */
export async function scoreSynthesisCandidates(
  currentItem: {
    id: string
    title: string
    content: string
  },
  similarItems: SimilarItem[],
  scoringPrompt: string,
  options: {
    concurrency?: number
    minTotalScore?: number
  } = {}
): Promise<ScoredCandidate[]> {
  const { concurrency = 5, minTotalScore = 10 } = options

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const currentNews = `${currentItem.title}\n\n${currentItem.content}`

  // Process in batches for rate limiting
  const results: ScoredCandidate[] = []

  for (let i = 0; i < similarItems.length; i += concurrency) {
    const batch = similarItems.slice(i, i + concurrency)

    const batchResults = await Promise.all(
      batch.map(async (item) => {
        const daysAgo = daysBetween(new Date(), new Date(item.collected_at))
        const historicalNews = `${item.title}\n\n${item.content}`

        try {
          const score = await scoreCandidate(
            anthropic,
            currentNews,
            historicalNews,
            daysAgo,
            scoringPrompt
          )

          return {
            sourceItem: currentItem,
            relatedItem: item,
            similarityScore: item.similarity,
            originalityScore: score.originality,
            relevanceScore: score.relevance,
            synthesisType: score.type,
            reasoning: score.reasoning,
            daysAgo,
            totalScore: score.originality + score.relevance,
          }
        } catch (error) {
          console.error(`[Scoring] Failed for item ${item.id}:`, error)
          return null
        }
      })
    )

    results.push(
      ...(batchResults.filter((r) => r !== null) as ScoredCandidate[])
    )

    // Small delay between batches
    if (i + concurrency < similarItems.length) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  // Filter and sort by total score
  return results
    .filter((r) => r.totalScore >= minTotalScore)
    .sort((a, b) => b.totalScore - a.totalScore)
}

/**
 * Get top N candidates per source item
 */
export function getTopCandidates(
  candidates: ScoredCandidate[],
  topN: number = 3
): ScoredCandidate[] {
  // Group by source item
  const bySource = new Map<string, ScoredCandidate[]>()

  for (const candidate of candidates) {
    const sourceId = candidate.sourceItem.id
    if (!bySource.has(sourceId)) {
      bySource.set(sourceId, [])
    }
    bySource.get(sourceId)!.push(candidate)
  }

  // Take top N from each source
  const result: ScoredCandidate[] = []

  for (const sourceCandidates of bySource.values()) {
    result.push(...sourceCandidates.slice(0, topN))
  }

  return result
}
