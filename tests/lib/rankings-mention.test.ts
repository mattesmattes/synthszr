import { describe, it, expect } from 'vitest'
import { mentionHash } from '@/lib/rankings/mention'

describe('mentionHash', () => {
  it('stabil pro productId (unabhängig von Excerpt)', () => {
    expect(mentionHash('p1')).toBe(mentionHash('p1'))
  })
  it('verschiedene Produkte → verschiedene Hashes', () => {
    expect(mentionHash('p1')).not.toBe(mentionHash('p2'))
  })
})
