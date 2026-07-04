import { describe, it, expect } from 'vitest'
import { buildProductInsert, normalizeVendorNamespace } from '@/lib/rankings/resolve-product-payload'

describe('normalizeVendorNamespace', () => {
  it('normalisiert Casing, Whitespace und Sonderzeichen', () => {
    expect(normalizeVendorNamespace(' Open AI ')).toBe('open-ai')
    expect(normalizeVendorNamespace('OpenAI')).toBe('openai')
    expect(normalizeVendorNamespace('open-ai')).toBe('open-ai')
  })
})

describe('buildProductInsert', () => {
  it('baut Felder + key + slug', () => {
    const r = buildProductInsert('OpenAI', 'GPT-5.6 Earth')
    expect(r.vendor_namespace).toBe('openai')
    expect(r.family).toBe('gpt'); expect(r.version).toBe('5.6'); expect(r.qualifier).toBe('earth')
    expect(r.canonical_key).toBe('openai@gpt@5.6@earth')
    expect(r.slug).toBe('openai-gpt-5-6-earth')
    expect(r.canonical_name).toBe('GPT-5.6 Earth')
  })
  it('Schreibvarianten → selber key + slug', () => {
    expect(buildProductInsert('openai', 'GPT-5.6').canonical_key)
      .toBe(buildProductInsert('OpenAI', 'gpt 5.6').canonical_key)
  })
  it('verschiedene Versionen → verschiedene keys', () => {
    expect(buildProductInsert('openai', 'GPT-5.6').canonical_key)
      .not.toBe(buildProductInsert('openai', 'GPT-5.5').canonical_key)
  })
  it('robuste Vendor-Normalisierung im key/slug', () => {
    expect(buildProductInsert(' Open AI ', 'GPT-5.6').vendor_namespace).toBe('open-ai')
    expect(buildProductInsert(' Open AI ', 'GPT-5.6').slug).toBe('open-ai-gpt-5-6')
  })
  it('lehnt leere Inputs ab', () => {
    expect(() => buildProductInsert('', 'GPT-5.6')).toThrow()
    expect(() => buildProductInsert('openai', '')).toThrow()
    expect(() => buildProductInsert('openai', '   ')).toThrow()
  })
  it('kanonisiert Konzern-Sub-Brand-Vendors (AWS → amazon)', () => {
    const r = buildProductInsert('Amazon Web Services', 'Bedrock AgentCore')
    expect(r.vendor_namespace).toBe('amazon')
    expect(r.slug.startsWith('amazon-')).toBe(true)
  })
})
