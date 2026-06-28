import { describe, it, expect } from 'vitest'
import { buildExtractPrompt, parseExtractResponse } from '@/lib/rankings/extract-products'

describe('buildExtractPrompt', () => {
  it('enthält Titel, Inhalt und die leere-Liste-Regel', () => {
    const p = buildExtractPrompt('OpenAI ships GPT-5.6', 'GPT-5.6 is faster ...')
    expect(p).toContain('OpenAI ships GPT-5.6')
    expect(p).toContain('GPT-5.6 is faster')
    expect(p.toLowerCase()).toContain('leere liste')
  })
})

describe('parseExtractResponse', () => {
  it('parst gültige Produktliste', () => {
    expect(parseExtractResponse({ products: [{ name: 'GPT-5.6', vendor: 'OpenAI', excerpt: 'x' }] }))
      .toEqual([{ name: 'GPT-5.6', vendor: 'OpenAI', excerpt: 'x' }])
  })
  it('filtert Einträge ohne name/vendor', () => {
    expect(parseExtractResponse({ products: [{ name: 'GPT-5.6', vendor: 'OpenAI' }, { name: '' }, { vendor: 'x' }] })).toHaveLength(1)
  })
  it('begrenzt überlange Strings (DB-Schutz)', () => {
    const r = parseExtractResponse({ products: [{ name: 'x'.repeat(500), vendor: 'y'.repeat(500), excerpt: 'z'.repeat(5000) }] })
    expect(r[0].name.length).toBeLessThanOrEqual(120)
    expect(r[0].vendor.length).toBeLessThanOrEqual(120)
    expect((r[0].excerpt ?? '').length).toBeLessThanOrEqual(2000)
  })
  it('toleriert Müll → []', () => {
    expect(parseExtractResponse(null)).toEqual([])
    expect(parseExtractResponse({})).toEqual([])
    expect(parseExtractResponse({ products: 'nope' })).toEqual([])
  })
})
