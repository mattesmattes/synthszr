// lib/news-queue/reranker.ts
import Anthropic from '@anthropic-ai/sdk'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { buildRerankerPrompt } from './few-shot'
import { parseRerankerResponse } from './reranker-parse'
import type { RankingCandidate, RankedSuggestion, LabelExample } from './ranking-types'

const TIMEOUT_MS = 45000

/** Fisher–Yates shuffle (deterministic seed not needed; mitigates positional bias). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Run the listwise reranker over candidates. Returns up to `targetCount`
 * suggestions with reasons. On any failure returns the top `targetCount`
 * candidates by totalScore (graceful degradation — UI keeps working).
 */
export async function runReranker(
  candidates: RankingCandidate[],
  positives: LabelExample[],
  negatives: LabelExample[],
  targetCount = 15
): Promise<RankedSuggestion[]> {
  const fallback = (): RankedSuggestion[] =>
    [...candidates]
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, targetCount)
      .map((c, i) => ({ queueItemId: c.queueItemId, rank: i + 1, reason: '(Fallback: Score)', confidence: 0.3 }))

  if (candidates.length === 0) return []
  if (!process.env.ANTHROPIC_API_KEY) return fallback()

  const validIds = new Set(candidates.map((c) => c.queueItemId))
  const prompt = buildRerankerPrompt(shuffle(candidates), positives, negatives, targetCount)

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const model = await getModelForUseCase('queue_ranking')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const response = await client.messages.create(
      { model, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] },
      { signal: controller.signal }
    )
    clearTimeout(timeout)
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    const parsed = parseRerankerResponse(text, validIds)
    return parsed.length > 0 ? parsed.slice(0, targetCount) : fallback()
  } catch (err) {
    console.warn('[Ranking] reranker failed, using score fallback:', err)
    return fallback()
  }
}
