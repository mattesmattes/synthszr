import { describe, expect, it } from 'vitest'
import { hasBundles } from '@/lib/claude/ghostwriter-pipeline'

describe('hasBundles', () => {
  it('true wenn topic oder recap Items', () => {
    expect(hasBundles({ topic: [1], recap: [] } as any)).toBe(true)
    expect(hasBundles({ topic: [], recap: [] } as any)).toBe(false)
  })
})
