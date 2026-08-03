import { describe, expect, it } from 'vitest'
import { GLOSSARY_MAX_PER_ARTICLE } from '@/lib/glossary/types'

describe('glossary types', () => {
  it('caps glossary links per article at 8', () => {
    expect(GLOSSARY_MAX_PER_ARTICLE).toBe(8)
  })
})
