import { describe, it, expect } from 'vitest'
import { truncateToHalf } from '@/lib/podcast/show-notes'

describe('truncateToHalf', () => {
  it('keeps roughly the first half by word count, ending on a sentence', () => {
    const text = 'One two three. Four five six. Seven eight nine. Ten eleven twelve.'
    const out = truncateToHalf(text)
    expect(out.length).toBeLessThan(text.length)
    expect(out.startsWith('One two three.')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns the text unchanged when it is a single short sentence', () => {
    const text = 'Just one sentence.'
    expect(truncateToHalf(text)).toBe('Just one sentence.')
  })

  it('handles empty input', () => {
    expect(truncateToHalf('')).toBe('')
  })
})
