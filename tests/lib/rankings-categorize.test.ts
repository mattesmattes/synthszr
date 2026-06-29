import { describe, it, expect } from 'vitest'
import { buildCategorizePrompt, parseCategorizeResponse } from '@/lib/rankings/categorize'

const CATS = [
  { slug: 'language-models', name: 'Sprachmodelle', description: 'LLMs' },
  { slug: 'coding-tools', name: 'Coding-Tools', description: 'IDEs' },
  { slug: 'other', name: 'Sonstige', description: 'Rest' },
]
const PRODUCTS = [
  { id: 'a', name: 'GPT-5.6', vendor: 'openai' },
  { id: 'b', name: 'Cursor', vendor: 'anysphere' },
]

describe('buildCategorizePrompt', () => {
  it('listet Kategorien (slug) und nummerierte Produkte', () => {
    const p = buildCategorizePrompt(PRODUCTS, CATS)
    expect(p).toContain('language-models')
    expect(p).toContain('coding-tools')
    expect(p).toContain('GPT-5.6')
    expect(p).toContain('Cursor')
    expect(p.toLowerCase()).toContain('other')
  })
})

describe('parseCategorizeResponse', () => {
  const valid = new Set(['language-models', 'coding-tools', 'other'])
  it('mappt gültige Zuordnungen auf Index', () => {
    const m = parseCategorizeResponse({ assignments: [{ index: 0, category: 'language-models' }, { index: 1, category: 'coding-tools' }] }, valid, 2)
    expect(m.get(0)).toBe('language-models')
    expect(m.get(1)).toBe('coding-tools')
  })
  it('verwirft unbekannte Kategorie-Slugs', () => {
    const m = parseCategorizeResponse({ assignments: [{ index: 0, category: 'erfunden' }] }, valid, 2)
    expect(m.has(0)).toBe(false)
  })
  it('verwirft Index außerhalb des Bereichs', () => {
    const m = parseCategorizeResponse({ assignments: [{ index: 9, category: 'other' }] }, valid, 2)
    expect(m.has(9)).toBe(false)
  })
  it('toleriert Müll → leere Map', () => {
    expect(parseCategorizeResponse(null, valid, 2).size).toBe(0)
    expect(parseCategorizeResponse({}, valid, 2).size).toBe(0)
  })
})
