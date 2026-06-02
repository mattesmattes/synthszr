import { describe, it, expect } from 'vitest'
import { recallAtK, ndcgAtK } from '@/lib/news-queue/metrics'

describe('recallAtK', () => {
  it('is fraction of relevant items found in top K', () => {
    expect(recallAtK(['a', 'x', 'b', 'y'], new Set(['a', 'b', 'c', 'd']), 3)).toBeCloseTo(0.5)
  })
  it('returns 0 when no relevant items exist', () => {
    expect(recallAtK(['a', 'b'], new Set<string>(), 2)).toBe(0)
  })
  it('caps consideration at K', () => {
    expect(recallAtK(['x', 'x', 'a'], new Set(['a']), 2)).toBe(0)
  })
})

describe('ndcgAtK', () => {
  it('is 1.0 for a perfect ranking', () => {
    expect(ndcgAtK(['a', 'b'], new Set(['a', 'b']), 2)).toBeCloseTo(1.0)
  })
  it('is lower when relevant items rank late', () => {
    const perfect = ndcgAtK(['a', 'b'], new Set(['a', 'b']), 2)
    const worse = ndcgAtK(['x', 'a'], new Set(['a']), 2)
    expect(worse).toBeLessThan(perfect)
  })
})
