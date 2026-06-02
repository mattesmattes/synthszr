import { describe, it, expect } from 'vitest'
import { buildRerankerPrompt } from '@/lib/news-queue/few-shot'
import type { RankingCandidate, LabelExample } from '@/lib/news-queue/ranking-types'

const candidates: RankingCandidate[] = [
  { queueItemId: 'a', title: 'Nvidia earnings', excerpt: 'chips', source: 'reuters.com', totalScore: 5, winnerSimilarity: 0.8 },
  { queueItemId: 'b', title: 'Crossword puzzle', excerpt: null, source: 'nyt.com', totalScore: 1, winnerSimilarity: 0.1 },
]
const positives: LabelExample[] = [{ title: 'OpenAI ships model', source: 'theverge.com' }]
const negatives: LabelExample[] = [{ title: 'Daily horoscope', source: 'x.com' }]

describe('buildRerankerPrompt', () => {
  it('includes every candidate id and title', () => {
    const p = buildRerankerPrompt(candidates, positives, negatives, 15)
    expect(p).toContain('a')
    expect(p).toContain('Nvidia earnings')
    expect(p).toContain('Crossword puzzle')
  })
  it('includes positive and negative example titles', () => {
    const p = buildRerankerPrompt(candidates, positives, negatives, 15)
    expect(p).toContain('OpenAI ships model')
    expect(p).toContain('Daily horoscope')
  })
  it('states the target count and required JSON shape', () => {
    const p = buildRerankerPrompt(candidates, positives, negatives, 12)
    expect(p).toContain('12')
    expect(p).toContain('queueItemId')
  })
  it('omits the examples sections when none are given', () => {
    const p = buildRerankerPrompt(candidates, [], [], 15)
    expect(p).not.toContain('FRÜHER AUSGEWÄHLT')
  })
})
