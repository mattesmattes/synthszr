import { describe, it, expect } from 'vitest'
import { buildAttributionPrompt, parseAttributionDecision } from '@/lib/rankings/attribution-qa'

const cand = {
  id: 'p1', slug: 'unknown-watermelon', vendor: 'unknown', family: 'watermelon',
  name: 'Watermelon', mentions: 2, context: 'Meta released Watermelon, a new model.',
  siblings: [{ id: 'p2', slug: 'meta-watermelon', vendor: 'meta', mentions: 4 }],
}

describe('buildAttributionPrompt', () => {
  it('enthält Name, Kontext und die Kandidaten-Slugs', () => {
    const prompt = buildAttributionPrompt(cand)
    expect(prompt).toContain('Watermelon')
    expect(prompt).toContain('meta-watermelon')
    expect(prompt).toContain('Meta released Watermelon')
  })
})

describe('parseAttributionDecision', () => {
  it('parst eine gültige Merge-Entscheidung', () => {
    const d = parseAttributionDecision({ merge_into_slug: 'meta-watermelon', confidence: 0.95, company: 'Meta', reasoning: 'gleiches Produkt' })
    expect(d).toEqual({ mergeIntoSlug: 'meta-watermelon', confidence: 0.95, company: 'Meta', reasoning: 'gleiches Produkt' })
  })
  it('parst null-Merge (kein Kanon-Match)', () => {
    const d = parseAttributionDecision({ merge_into_slug: null, confidence: 0.4, company: null, reasoning: 'unklar' })
    expect(d?.mergeIntoSlug).toBeNull()
  })
  it('liefert null bei kaputter Struktur', () => {
    expect(parseAttributionDecision({ foo: 1 })).toBeNull()
    expect(parseAttributionDecision(null)).toBeNull()
  })
})
