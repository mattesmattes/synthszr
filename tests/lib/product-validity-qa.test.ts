import { describe, expect, it } from 'vitest'
import { buildValidityPrompt, parseValidityDecision } from '@/lib/rankings/product-validity-qa'

describe('parseValidityDecision', () => {
  it('parst eine gültige Tool-Antwort', () => {
    expect(parseValidityDecision({ is_product: false, confidence: 0.9, reasoning: 'Alltagswort' }))
      .toEqual({ isProduct: false, confidence: 0.9, reasoning: 'Alltagswort' })
  })
  it('null bei ungültiger/fehlender Antwort', () => {
    expect(parseValidityDecision(null)).toBeNull()
    expect(parseValidityDecision({ is_product: 'no' })).toBeNull()
    expect(parseValidityDecision({ is_product: true, confidence: 2, reasoning: 'x' })).toBeNull() // conf > 1
    expect(parseValidityDecision({ is_product: true, confidence: 0.5 })).toBeNull() // reasoning fehlt
  })
})

describe('buildValidityPrompt', () => {
  it('enthält Namen, Textstellen und das Ausgabefeld', () => {
    const p = buildValidityPrompt({ id: '1', name: 'Vision', excerpts: ['nicht der Vision, sondern'] })
    expect(p).toContain('Vision')
    expect(p).toContain('nicht der Vision')
    expect(p).toContain('is_product')
  })
  it('behandelt fehlende Textstellen', () => {
    const p = buildValidityPrompt({ id: '1', name: 'Norm', excerpts: [] })
    expect(p).toContain('(keine')
    expect(p).toContain('Norm')
  })
})
