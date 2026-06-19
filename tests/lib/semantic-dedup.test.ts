import { describe, it, expect } from 'vitest'
import { clusterByEmbedding } from '@/lib/news-queue/semantic-dedup'

// Helper: 2-D unit-ish vectors so cosine similarity is easy to reason about.
const A = [1, 0]            // baseline
const A_NEAR = [0.98, 0.02] // ~0.999 cosine to A
const ORTHOGONAL = [0, 1]   // 0 cosine to A

describe('clusterByEmbedding', () => {
  it('drops a later item whose embedding is near a kept item (>= threshold)', () => {
    const items = [{ id: '1', title: 'DeepSeek raises $7.4B' }, { id: '2', title: 'first external round closes' }]
    const { kept, dropped } = clusterByEmbedding(items, [A, A_NEAR], 0.8)
    expect(kept.map(k => k.id)).toEqual(['1'])
    expect(dropped).toHaveLength(1)
    expect(dropped[0].id).toBe('2')
    expect(dropped[0].similarTo).toBe('1')
    expect(dropped[0].similarity).toBeGreaterThanOrEqual(0.8)
  })

  it('keeps both items when embeddings are dissimilar (< threshold)', () => {
    const items = [{ id: '1', title: 'AI policy' }, { id: '2', title: 'robotics' }]
    const { kept, dropped } = clusterByEmbedding(items, [A, ORTHOGONAL], 0.8)
    expect(kept.map(k => k.id)).toEqual(['1', '2'])
    expect(dropped).toHaveLength(0)
  })

  it('keeps the first occurrence (caller pre-sorts best-first)', () => {
    const items = [{ id: 'best', title: 'x' }, { id: 'dupe1', title: 'y' }, { id: 'dupe2', title: 'z' }]
    const { kept, dropped } = clusterByEmbedding(items, [A, A_NEAR, A_NEAR], 0.8)
    expect(kept.map(k => k.id)).toEqual(['best'])
    expect(dropped.map(d => d.id)).toEqual(['dupe1', 'dupe2'])
    expect(dropped.every(d => d.similarTo === 'best')).toBe(true)
  })

  it('always keeps an item with a missing/empty embedding (cannot judge it)', () => {
    const items = [{ id: '1', title: 'a' }, { id: '2', title: 'b' }, { id: '3', title: 'c' }]
    const { kept } = clusterByEmbedding(items, [A, [], A_NEAR], 0.8)
    // 2 kept (empty embedding), 3 dropped (near 1)
    expect(kept.map(k => k.id)).toEqual(['1', '2'])
  })

  it('returns input unchanged for 0 or 1 items', () => {
    expect(clusterByEmbedding([], [], 0.8)).toEqual({ kept: [], dropped: [] })
    const one = [{ id: '1', title: 'a' }]
    expect(clusterByEmbedding(one, [A], 0.8).kept).toEqual(one)
  })

  it('tags batch duplicates with reason "batch"', () => {
    const items = [{ id: '1', title: 'x' }, { id: '2', title: 'y' }]
    const { dropped } = clusterByEmbedding(items, [A, A_NEAR], 0.8)
    expect(dropped[0].reason).toBe('batch')
  })
})

describe('clusterByEmbedding — recent coverage (prior embeddings)', () => {
  it('drops an item that matches recent coverage, reason "recent_coverage"', () => {
    const items = [{ id: '1', title: 'DeepSeek raises $7.4B' }]
    const prior = [{ title: 'DeepSeek $7.4B round (yesterday)', embedding: A_NEAR }]
    const { kept, dropped } = clusterByEmbedding(items, [A], 0.8, prior)
    expect(kept).toHaveLength(0)
    expect(dropped).toHaveLength(1)
    expect(dropped[0].reason).toBe('recent_coverage')
    expect(dropped[0].similarTo).toBe('DeepSeek $7.4B round (yesterday)')
    expect(dropped[0].similarity).toBeGreaterThanOrEqual(0.8)
  })

  it('keeps an item whose embedding is unlike all recent coverage', () => {
    const items = [{ id: '1', title: 'fresh topic' }]
    const prior = [{ title: 'old unrelated story', embedding: ORTHOGONAL }]
    const { kept, dropped } = clusterByEmbedding(items, [A], 0.8, prior)
    expect(kept.map(k => k.id)).toEqual(['1'])
    expect(dropped).toHaveLength(0)
  })

  it('drops only the covered item, keeps the unrelated one', () => {
    // item 1 is unrelated to coverage (kept); item 2 repeats covered news (dropped)
    const items = [{ id: '1', title: 'unrelated' }, { id: '2', title: 'repeat' }]
    const prior = [{ title: 'covered last week', embedding: A }]
    const { kept, dropped } = clusterByEmbedding(items, [ORTHOGONAL, A_NEAR], 0.8, prior)
    expect(kept.map(k => k.id)).toEqual(['1'])
    expect(dropped).toHaveLength(1)
    expect(dropped[0].id).toBe('2')
    expect(dropped[0].reason).toBe('recent_coverage')
  })
})
