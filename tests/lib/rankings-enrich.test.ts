import { describe, it, expect } from 'vitest'
import { buildEnrichPrompt, parseEnrichResponse } from '@/lib/rankings/enrich'

describe('buildEnrichPrompt', () => {
  it('enthält Produkt, Dimensionen und Belege', () => {
    const p = buildEnrichPrompt(
      { name: 'GPT-5.6', vendor: 'openai' },
      'Sprachmodelle',
      ['Kontextfenster', 'Reasoning'],
      ['GPT-5.6 has a huge context window', 'strong at reasoning'],
    )
    expect(p).toContain('GPT-5.6')
    expect(p).toContain('Kontextfenster')
    expect(p).toContain('Reasoning')
    expect(p).toContain('huge context window')
    expect(p.toLowerCase()).toContain('sentiment')
  })
})

describe('parseEnrichResponse', () => {
  const dims = new Set(['Kontextfenster', 'Reasoning'])
  it('parst Sentiment + bekannte Features', () => {
    const r = parseEnrichResponse({
      sentiment: { label: 'positiv', score: 0.7 },
      features: [
        { dimension: 'Kontextfenster', value: '1M Token', evidence: 'huge context' },
        { dimension: 'Reasoning', value: 'stark', evidence: 'strong at reasoning' },
      ],
    }, dims)
    expect(r.sentiment?.label).toBe('positiv')
    expect(r.sentiment?.score).toBeCloseTo(0.7)
    expect(r.features).toHaveLength(2)
  })
  it('verwirft unbekannte Dimensionen + leere Werte', () => {
    const r = parseEnrichResponse({
      sentiment: { label: 'neutral', score: 0 },
      features: [
        { dimension: 'Erfunden', value: 'x' },
        { dimension: 'Reasoning', value: '' },
        { dimension: 'Kontextfenster', value: 'unbekannt' },
        { dimension: 'Reasoning', value: 'gut', evidence: 'e' },
      ],
    }, dims)
    expect(r.features).toHaveLength(1)
    expect(r.features[0].dimension).toBe('Reasoning')
  })
  it('verwirft Features ohne Beleg (evidence-Pflicht)', () => {
    const r = parseEnrichResponse({
      sentiment: { label: 'neutral', score: 0 },
      features: [
        { dimension: 'Reasoning', value: 'stark' }, // kein evidence → raus
        { dimension: 'Kontextfenster', value: '1M', evidence: 'huge context' }, // bleibt
      ],
    }, dims)
    expect(r.features).toHaveLength(1)
    expect(r.features[0].dimension).toBe('Kontextfenster')
  })
  it('clamped Sentiment-Score auf [-1,1]', () => {
    expect(parseEnrichResponse({ sentiment: { label: 'positiv', score: 5 }, features: [] }, dims).sentiment?.score).toBe(1)
    expect(parseEnrichResponse({ sentiment: { label: 'negativ', score: -9 }, features: [] }, dims).sentiment?.score).toBe(-1)
  })
  it('toleriert Müll → null Sentiment + leere Features', () => {
    const r = parseEnrichResponse(null, dims)
    expect(r.sentiment).toBeNull()
    expect(r.features).toEqual([])
  })
})
