import { describe, it, expect } from 'vitest'
import { canonicalKey, productSlug, normalizeAlias, parseProductName } from '@/lib/rankings/canonicalize'

describe('parseProductName', () => {
  it('trennt family, version und qualifier', () => {
    expect(parseProductName('GPT-5.6 Earth')).toEqual({ family: 'gpt', version: '5.6', qualifier: 'earth' })
  })
  it('hält verschiedene Versionen getrennt', () => {
    expect(parseProductName('GPT-5.5')).toEqual({ family: 'gpt', version: '5.5', qualifier: null })
    expect(parseProductName('GPT-5.6')).toEqual({ family: 'gpt', version: '5.6', qualifier: null })
  })
  it('qualifier vor der version (Claude Opus 4.8)', () => {
    expect(parseProductName('Claude Opus 4.8')).toEqual({ family: 'claude', version: '4.8', qualifier: 'opus' })
  })
  it('repariert fehlendes Leerzeichen (GPT5.6 → 5.6)', () => {
    expect(parseProductName('GPT5.6')).toEqual({ family: 'gpt', version: '5.6', qualifier: null })
  })
  it('mergt Schreibvarianten auf dieselbe Zerlegung', () => {
    expect(parseProductName('gpt 5.6')).toEqual(parseProductName('GPT-5.6'))
  })
  it('produkt ohne version', () => {
    expect(parseProductName('Cursor')).toEqual({ family: 'cursor', version: null, qualifier: null })
  })
  it('version mit Buchstaben-Suffix (GPT-4o)', () => {
    expect(parseProductName('GPT-4o')).toEqual({ family: 'gpt', version: '4o', qualifier: null })
  })
  it('Gemini 2.5 Pro', () => {
    expect(parseProductName('Gemini 2.5 Pro')).toEqual({ family: 'gemini', version: '2.5', qualifier: 'pro' })
  })
  it('Claude 3.5 Sonnet', () => {
    expect(parseProductName('Claude 3.5 Sonnet')).toEqual({ family: 'claude', version: '3.5', qualifier: 'sonnet' })
  })
  it('DALL-E 3', () => {
    expect(parseProductName('DALL-E 3')).toEqual({ family: 'dall e', version: '3', qualifier: null })
  })
  it('o3-mini', () => {
    expect(parseProductName('o3-mini')).toEqual({ family: 'o', version: '3', qualifier: 'mini' })
  })
  it('Llama 3.1 405B (size-token als qualifier)', () => {
    expect(parseProductName('Llama 3.1 405B')).toEqual({ family: 'llama', version: '3.1', qualifier: '405b' })
  })
  it('wirft bei leerem Namen', () => {
    expect(() => parseProductName('   ')).toThrow()
  })
})

describe('canonicalKey', () => {
  it('baut vendor@family@version@qualifier', () => {
    expect(canonicalKey('openai', parseProductName('GPT-5.6 Earth'))).toBe('openai@gpt@5.6@earth')
  })
  it('trennt verschiedene Vendors bei generischem Namen', () => {
    expect(canonicalKey('google', parseProductName('Studio')))
      .not.toBe(canonicalKey('adobe', parseProductName('Studio')))
  })
  it('leere version/qualifier als leerer Slot', () => {
    expect(canonicalKey('anysphere', parseProductName('Cursor'))).toBe('anysphere@cursor@@')
  })
  it('lowercased family auch bei manuell gebautem ParsedProduct (SQL-Konsistenz)', () => {
    expect(canonicalKey('OpenAI', { family: 'GPT', version: '5.6', qualifier: 'Earth' }))
      .toBe('openai@gpt@5.6@Earth')
  })
})

describe('productSlug', () => {
  it('vendor-namespaced, lesbar', () => {
    expect(productSlug('openai', parseProductName('GPT-5.6 Earth'))).toBe('openai-gpt-5-6-earth')
  })
  it('generische Namen kollidieren nicht über Vendors', () => {
    expect(productSlug('google', parseProductName('Studio'))).toBe('google-studio')
    expect(productSlug('adobe', parseProductName('Studio'))).toBe('adobe-studio')
  })
})

describe('normalizeAlias', () => {
  it('casefold + Separator-Normalisierung', () => {
    expect(normalizeAlias('GPT-5.6')).toBe(normalizeAlias('gpt 5.6'))
    expect(normalizeAlias('  Cursor  ')).toBe('cursor')
  })
})
