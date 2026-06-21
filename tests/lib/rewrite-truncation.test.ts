import { describe, it, expect } from 'vitest'
import { isLikelyTruncated } from '@/lib/claude/rewrite-truncation'

describe('isLikelyTruncated', () => {
  it('accepts a rewrite of roughly the same length (proofread fixes spelling only)', () => {
    const original = 'a'.repeat(10000)
    const rewritten = 'a'.repeat(9900) // 99%
    expect(isLikelyTruncated(original, rewritten)).toBe(false)
  })

  it('flags a rewrite that is much shorter than the original (truncated at max_tokens)', () => {
    const original = 'a'.repeat(10000)
    const rewritten = 'a'.repeat(6000) // 60% — cut off
    expect(isLikelyTruncated(original, rewritten)).toBe(true)
  })

  it('flags an empty rewrite', () => {
    expect(isLikelyTruncated('a'.repeat(5000), '')).toBe(true)
  })

  it('accepts a slightly longer rewrite (corrections can add characters)', () => {
    const original = 'a'.repeat(10000)
    const rewritten = 'a'.repeat(10200)
    expect(isLikelyTruncated(original, rewritten)).toBe(false)
  })

  it('never flags very short originals (nothing to truncate)', () => {
    // A tiny article can legitimately shrink; the guard targets long-article cutoff
    expect(isLikelyTruncated('Kurz.', '')).toBe(false)
  })

  it('respects a custom ratio', () => {
    const original = 'a'.repeat(10000)
    const rewritten = 'a'.repeat(8000) // 80%
    expect(isLikelyTruncated(original, rewritten, 0.9)).toBe(true)
    expect(isLikelyTruncated(original, rewritten, 0.7)).toBe(false)
  })
})
