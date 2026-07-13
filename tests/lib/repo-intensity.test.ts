import { describe, it, expect } from 'vitest'
import { repoRetrievalParams } from '@/lib/mattes/repo-intensity'

describe('repoRetrievalParams', () => {
  it('gibt null bei 0 (aus)', () => {
    expect(repoRetrievalParams(0)).toBeNull()
  })
  it('klemmt negative Werte auf null', () => {
    expect(repoRetrievalParams(-10)).toBeNull()
  })
  it('1–25 → 1 Passage', () => {
    expect(repoRetrievalParams(1)).toEqual({ limit: 1, threshold: 0.5 })
    expect(repoRetrievalParams(25)).toEqual({ limit: 1, threshold: 0.5 })
  })
  it('26–50 → 2 Passagen', () => {
    expect(repoRetrievalParams(26)).toEqual({ limit: 2, threshold: 0.5 })
    expect(repoRetrievalParams(50)).toEqual({ limit: 2, threshold: 0.5 })
  })
  it('51–75 → 3 Passagen', () => {
    expect(repoRetrievalParams(51)).toEqual({ limit: 3, threshold: 0.5 })
    expect(repoRetrievalParams(75)).toEqual({ limit: 3, threshold: 0.5 })
  })
  it('76–100 → 4 Passagen, threshold 0.45', () => {
    expect(repoRetrievalParams(76)).toEqual({ limit: 4, threshold: 0.45 })
    expect(repoRetrievalParams(100)).toEqual({ limit: 4, threshold: 0.45 })
  })
  it('klemmt >100 auf die oberste Stufe', () => {
    expect(repoRetrievalParams(150)).toEqual({ limit: 4, threshold: 0.45 })
  })
})
