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

  // Create a timeout promise (30 seconds)
  const timeoutMs = 30000
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Scoring timeout after ${timeoutMs}ms`)), timeoutMs)
  })

  // Race between API call and timeout
  const response = await Promise.race([
    anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
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
export async function scoreContentOnly(
  items: Array<{ id: string; title: string; content: string }>,
  options: { concurrency?: number } = {}
): Promise<Map<string, ContentScore>> {
  const { concurrency = 5 } = options

  if (items.length === 0) {
    return new Map()
  }

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const results = new Map<string, ContentScore>()

  // Scoring prompt for content-only items
  const scoringPrompt = `Du bewertest Newsletter-Artikel für ein professionelles Tech/Business-Publikum (Digital, Design, Tech, Business).

ARTIKEL:
{article_content}

Bewerte diesen Artikel auf einer Skala von 0-10:

1. SUBSTANZ (0-10): Ist dies ein echter Artikel mit inhaltlicher Tiefe?
   - 0-2: Navigations-Element, Spam, oder reine Werbung (z.B. "Play Spelling Bee", "Privacy Policy", "Subscribe")
   - 3-4: Sehr kurzer Teaser ohne echten Inhalt
   - 5-6: Durchschnittlicher Artikel mit wenig Tiefe
   - 7-8: Guter Artikel mit klarem Mehrwert
   - 9-10: Ausgezeichneter Artikel mit einzigartigen Insights

2. RELEVANZ (0-10): Wie relevant ist dies für Digital/Design/Tech/Business-Profis?
   - 0-2: Keine Relevanz (Spiele, Rezepte, etc.)
   - 3-4: Geringe Relevanz (allgemeine News)
   - 5-6: Moderate Relevanz (indirekt nützlich)
   - 7-8: Hohe Relevanz (direkt nützlich für die Arbeit)
   - 9-10: Sehr hohe Relevanz (strategisch wichtig)

3. NEUHEIT (0-10): Wie neuartig ist der Inhalt?
   - 0-2: Allgemein bekannt oder trivial
   - 3-4: Wenig originell
   - 5-6: Durchschnittlich
   - 7-8: Interessante neue Perspektive
   - 9-10: Bahnbrechende Erkenntnis

Antworte im Format:
SUBSTANZ: [Zahl]
RELEVANZ: [Zahl]
NEUHEIT: [Zahl]
BEGRÜNDUNG: [1 Satz warum]`

  // Process in batches
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)

    const batchResults = await Promise.all(
      batch.map(async (item) => {
        const articleContent = `${item.title}\n\n${item.content || ''}`
        const prompt = scoringPrompt.replace('{article_content}', articleContent.slice(0, 2000))

        // Timeout for each scoring request
        const timeoutMs = 30000
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Content scoring timeout after ${timeoutMs}ms`)), timeoutMs)
        })

        try {
          const response = await Promise.race([
            anthropic.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 256,
              messages: [{ role: 'user', content: prompt }],
            }),
            timeoutPromise,
          ])

          const text = response.content[0].type === 'text' ? response.content[0].text : ''

          // Parse response
          const substanzMatch = text.match(/SUBSTANZ:\s*(\d+)/i)
          const relevanzMatch = text.match(/RELEVANZ:\s*(\d+)/i)
          const neuheitMatch = text.match(/NEUHEIT:\s*(\d+)/i)
          const reasoningMatch = text.match(/BEGRÜNDUNG:\s*([\s\S]+?)(?:\n\n|$)/i)

          const score: ContentScore = {
            synthesisScore: substanzMatch ? parseInt(substanzMatch[1], 10) : 3,
            relevanceScore: relevanzMatch ? parseInt(relevanzMatch[1], 10) : 3,
            uniquenessScore: neuheitMatch ? parseInt(neuheitMatch[1], 10) : 3,
            reasoning: reasoningMatch?.[1]?.trim() || 'Keine Begründung',
          }

          return { id: item.id, score }
        } catch (error) {
          console.error(`[ContentScoring] Failed for item ${item.id}:`, error)
          // Return low scores on error (better than high defaults)
          return {
            id: item.id,
            score: {
              synthesisScore: 2,
              relevanceScore: 2,
              uniquenessScore: 2,
              reasoning: 'Scoring fehlgeschlagen',
            },
          }
        }
      })
    )

    for (const result of batchResults) {
      results.set(result.id, result.score)
    }

    // Small delay between batches
    if (i + concurrency < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  return results
}
