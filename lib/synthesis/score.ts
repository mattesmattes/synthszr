/**
 * Synthesis Candidate Scoring Service
 * Uses Claude Haiku for fast, cost-effective evaluation of synthesis candidates
 */

import Anthropic from '@anthropic-ai/sdk'
import { SimilarItem, daysBetween } from './search'
import { getModelForUseCase } from '@/lib/ai/model-config'

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
  scoringPrompt: string,
  modelId: string
): Promise<ScoreResponse> {
  const prompt = scoringPrompt
    .replace('{current_news}', currentNews.slice(0, 2000))
    .replace('{historical_news}', historicalNews.slice(0, 2000))
    .replace('{days_ago}', String(daysAgo))

  // Create a timeout promise (30 seconds)
  const timeoutMs = 30000
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Scoring timeout after ${timeoutMs}ms`)), timeoutMs)
  })

  // Race between API call and timeout
  const response = await Promise.race([
    anthropic.messages.create({
      model: modelId,
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    }),
    timeoutPromise,
  ])

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

  const modelId = await getModelForUseCase('synthesis_scoring')
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
            scoringPrompt,
            modelId
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

/**
 * Content-only scoring result
 */
export interface ContentScore {
  synthesisScore: number   // 0-10: Is this a real article with substance?
  relevanceScore: number   // 0-10: Relevant for Digital/Design/Tech/Business audience?
  uniquenessScore: number  // 0-10: Novel insight for the target audience?
  reasoning: string
}

/**
 * Score items WITHOUT historical matches using content analysis
 * Uses Claude Haiku to evaluate article quality for the target audience
 */
// Number of articles scored per single Claude call (batch scoring)
const ARTICLES_PER_CALL = 10

/**
 * Score a group of articles in a single Claude call.
 * Returns scores keyed by item id. Falls back to low scores on parse/API failure.
 */
async function scoreArticleGroup(
  anthropic: Anthropic,
  group: Array<{ id: string; title: string; content: string }>,
  modelId: string
): Promise<Array<{ id: string; score: ContentScore }>> {
  const articleBlocks = group
    .map((item, i) => {
      const text = `${item.title}\n\n${item.content || ''}`.slice(0, 800)
      return `ARTIKEL_${i + 1}:\n${text}`
    })
    .join('\n\n---\n\n')

  const prompt = `Bewerte diese ${group.length} Newsletter-Artikel für ein professionelles Tech/Business-Publikum.

Kriterien (Skala 0-10):
- SUBSTANZ: Inhaltliche Tiefe (0-2=Spam/Werbung/Navigation, 3-4=Teaser, 5-6=normal, 7-8=gut, 9-10=exzellent)
- RELEVANZ: Für Digital/Design/Tech/Business-Profis (0-2=irrelevant, 5-6=moderat, 7-8=hoch, 9-10=strategisch)
- NEUHEIT: Originalität des Inhalts (0-2=trivial, 5-6=durchschnittlich, 7-8=interessant, 9-10=bahnbrechend)

${articleBlocks}

Antworte EXAKT in diesem Format (eine Zeile pro Artikel, keine anderen Zeilen):
ARTIKEL_1: SUBSTANZ:X RELEVANZ:X NEUHEIT:X
ARTIKEL_2: SUBSTANZ:X RELEVANZ:X NEUHEIT:X`

  const timeoutMs = 60000
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Batch scoring timeout after ${timeoutMs}ms`)), timeoutMs)
  )

  const fallback = (reason: string) =>
    group.map(item => ({
      id: item.id,
      score: { synthesisScore: 2, relevanceScore: 2, uniquenessScore: 2, reasoning: reason },
    }))

  try {
    const response = await Promise.race([
      anthropic.messages.create({
        model: modelId,
        max_tokens: group.length * 25 + 50,
        messages: [{ role: 'user', content: prompt }],
      }),
      timeoutPromise,
    ])

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

    return group.map((item, i) => {
      const regex = new RegExp(
        `ARTIKEL_${i + 1}:\\s*SUBSTANZ:(\\d+)\\s+RELEVANZ:(\\d+)\\s+NEUHEIT:(\\d+)`,
        'i'
      )
      const match = text.match(regex)
      if (match) {
        return {
          id: item.id,
          score: {
            synthesisScore: parseInt(match[1], 10),
            relevanceScore: parseInt(match[2], 10),
            uniquenessScore: parseInt(match[3], 10),
            reasoning: '',
          },
        }
      }
      return { id: item.id, score: { synthesisScore: 3, relevanceScore: 3, uniquenessScore: 3, reasoning: 'Parse-Fehler' } }
    })
  } catch (error) {
    console.error(`[ContentScoring] Batch failed:`, error)
    return fallback('Batch-Scoring fehlgeschlagen')
  }
}

/**
 * Score items using batch Claude calls (10 articles per call).
 * 926 items → ~93 Claude calls instead of 926 — fits easily within Vercel 300s limit.
 */
export async function scoreContentOnly(
  items: Array<{ id: string; title: string; content: string }>,
  options: { concurrency?: number; onProgress?: (scored: number, total: number) => void } = {}
): Promise<Map<string, ContentScore>> {
  const { concurrency = 8, onProgress } = options

  if (items.length === 0) return new Map()

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const modelId = await getModelForUseCase('synthesis_scoring')
  const results = new Map<string, ContentScore>()

  // Split items into groups of ARTICLES_PER_CALL
  const groups: Array<typeof items> = []
  for (let i = 0; i < items.length; i += ARTICLES_PER_CALL) {
    groups.push(items.slice(i, i + ARTICLES_PER_CALL))
  }

  console.log(`[ContentScoring] ${items.length} items → ${groups.length} batch calls (${ARTICLES_PER_CALL}/call, concurrency=${concurrency})`)

  // Process groups in parallel batches
  for (let i = 0; i < groups.length; i += concurrency) {
    const parallelGroups = groups.slice(i, i + concurrency)

    const batchResults = await Promise.all(
      parallelGroups.map(group => scoreArticleGroup(anthropic, group, modelId))
    )

    for (const groupResult of batchResults) {
      for (const { id, score } of groupResult) {
        results.set(id, score)
      }
    }

    if (onProgress) {
      onProgress(Math.min(results.size, items.length), items.length)
    }

    if (i + concurrency < groups.length) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }

  return results
}
