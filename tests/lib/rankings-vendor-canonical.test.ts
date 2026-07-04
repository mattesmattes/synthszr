import { describe, it, expect } from 'vitest'
import { canonicalVendor, vendorDisplayName, namespacesForCompany } from '@/lib/rankings/vendor-canonical'

describe('canonicalVendor', () => {
  it('mappt Konzern-Sub-Brands auf den Kanon', () => {
    expect(canonicalVendor('amazon-web-services')).toBe('amazon')
    expect(canonicalVendor('aws')).toBe('amazon')
    expect(canonicalVendor('google-deepmind')).toBe('google')
    expect(canonicalVendor('deepmind')).toBe('google')
    expect(canonicalVendor('github')).toBe('microsoft')
    expect(canonicalVendor('mistral-ai')).toBe('mistral')
    expect(canonicalVendor('instagram')).toBe('meta')
  })
  it('lässt bekannte Kanon-Vendors unverändert', () => {
    expect(canonicalVendor('amazon')).toBe('amazon')
    expect(canonicalVendor('openai')).toBe('openai')
  })
  it('normalisiert Casing/Whitespace und lässt unbekannte durch', () => {
    expect(canonicalVendor('  AWS ')).toBe('amazon')
    expect(canonicalVendor('acme-labs')).toBe('acme-labs')
    expect(canonicalVendor('')).toBe('')
    expect(canonicalVendor(null)).toBe('')
  })
})

describe('vendorDisplayName', () => {
  it('liefert schöne Namen für bekannte Vendors (nach Alias)', () => {
    expect(vendorDisplayName('amazon-web-services')).toBe('Amazon')
    expect(vendorDisplayName('openai')).toBe('OpenAI')
    expect(vendorDisplayName('xai')).toBe('xAI')
    expect(vendorDisplayName('mistral-ai')).toBe('Mistral AI')
  })
  it('kapitalisiert unbekannte Slugs lesbar', () => {
    expect(vendorDisplayName('acme-labs')).toBe('Acme Labs')
    expect(vendorDisplayName('unknown')).toBe('Unknown')
  })
})

describe('namespacesForCompany', () => {
  it('liefert den Kanon plus alle Aliase', () => {
    const ns = namespacesForCompany('amazon')
    expect(ns).toContain('amazon')
    expect(ns).toContain('aws')
    expect(ns).toContain('amazon-web-services')
  })
  it('liefert für aliasfreie Company nur sich selbst', () => {
    expect(namespacesForCompany('openai')).toEqual(['openai'])
  })
})
