import { describe, it, expect } from 'vitest'
import { reciprocalRankFusion } from '@/lib/news-queue/rrf'

describe('reciprocalRankFusion', () => {
  it('ranks an item high when both lists rank it high', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c'], ['a', 'c', 'b']], 60)
    expect(fused[0]).toBe('a')
  })
  it('includes items present in only one list', () => {
    const fused = reciprocalRankFusion([['a', 'b'], ['c']], 60)
    expect(new Set(fused)).toEqual(new Set(['a', 'b', 'c']))
  })
  it('uses k to dampen rank weight', () => {
    const fused = reciprocalRankFusion([['x', 'a'], ['x', 'b']], 0)
    expect(fused[0]).toBe('x')
  })
})
