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
  it('o3-mini (kurzer Identifier o3 bleibt intakt)', () => {
    expect(parseProductName('o3-mini')).toEqual({ family: 'o3', version: null, qualifier: 'mini' })
  })
  it('Llama 3.1 405B (size-token als qualifier)', () => {
    expect(parseProductName('Llama 3.1 405B')).toEqual({ family: 'llama', version: '3.1', qualifier: '405b' })
  })
  it('wirft bei leerem Namen', () => {
    expect(() => parseProductName('   ')).toThrow()
  })

  // Varianten-Konsistenz: benannte Varianten derselben Version → gleiche family+version,
  // nur qualifier unterscheidet (alles NACH der Version ist Qualifier).
  it('GPT-5.6 Varianten teilen family+version (Sol/Terra/Luna)', () => {
    const sol = parseProductName('GPT-5.6 Sol')
    const terra = parseProductName('GPT-5.6 Terra')
    const luna = parseProductName('GPT-5.6 Luna')
    const plain = parseProductName('GPT-5.6')
    for (const v of [sol, terra, luna, plain]) {
      expect(v.family).toBe('gpt')
      expect(v.version).toBe('5.6')
    }
    expect(sol.qualifier).toBe('sol')
    expect(terra.qualifier).toBe('terra')
    expect(luna.qualifier).toBe('luna')
    expect(plain.qualifier).toBeNull()
  })
  it('Ornith Dense/MoE-Varianten teilen family (Architektur als Qualifier)', () => {
    const dense = parseProductName('Ornith-1.0-9B Dense')
    const moe = parseProductName('Ornith-1.0-35B MoE')
    expect(dense.family).toBe('ornith')
    expect(moe.family).toBe('ornith')
    expect(dense.version).toBe('1.0')
    expect(dense.qualifier).toContain('9b')
    expect(moe.qualifier).toContain('moe')
  })
  it('DeepSeek-V4-Pro (V4 → version, Pro → qualifier)', () => {
    expect(parseProductName('DeepSeek-V4-Pro')).toEqual({ family: 'deepseek', version: '4', qualifier: 'pro' })
  })
  it('1.6T Size-Token wird Qualifier, nicht family', () => {
    const p = parseProductName('DeepSeek-V4-Pro-1.6T')
    expect(p.family).toBe('deepseek')
    expect(p.qualifier).toContain('1.6t')
  })
  it('strippt model-Füllwort', () => {
    expect(parseProductName('Codex 5.2 model')).toEqual({ family: 'codex', version: '5.2', qualifier: null })
  })
  it('keine leere family — Qualifier wird promotet (Opus 4.5)', () => {
    expect(parseProductName('Opus 4.5')).toEqual({ family: 'opus', version: '4.5', qualifier: null })
  })
  it('normalisiert Unicode-Bindestrich (U+2011) wie ASCII', () => {
    expect(parseProductName('GPT‑5.6')).toEqual(parseProductName('GPT-5.6'))
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
