import { describe, expect, it } from 'vitest'
import {
  isAutolinkStopword,
  isCommonWordNonProduct,
  isExcludedProduct,
} from '@/lib/rankings/product-exclusions'

describe('isCommonWordNonProduct (harte Charts-Exclusion)', () => {
  it('blockt reine Konzept-/Allerweltswörter', () => {
    for (const w of ['Agents', 'apps', 'ChatBots', 'reasoning', 'Benchmark', 'Dataset']) {
      expect(isCommonWordNonProduct(w)).toBe(true)
    }
  })
  it('lässt echte Produkte durch — auch Single-Word-Namen', () => {
    for (const w of ['Codex', 'Sora', 'Atlas', 'Composer', 'Cursor', 'Norm', 'Vision', 'LLM']) {
      expect(isCommonWordNonProduct(w)).toBe(false)
    }
  })
})

describe('isAutolinkStopword (Blog-Anzeige unterdrücken, Produkt bleibt in Charts)', () => {
  it('unterdrückt mehrdeutige Wörter mit gleichnamigem echten Produkt', () => {
    for (const w of ['LLM', 'Pitch', 'Edits', 'Norm', 'Vision', 'tempo', 'vibe']) {
      expect(isAutolinkStopword(w)).toBe(true)
    }
  })
  it('verlinkt eindeutige Produktnamen weiter', () => {
    for (const w of ['Sora', 'Codex', 'Claude Code', 'Gemini CLI']) {
      expect(isAutolinkStopword(w)).toBe(false)
    }
  })
})

describe('isExcludedProduct (reine Vendor-Namen) bleibt unverändert', () => {
  it('blockt Herstellernamen, nicht Produkte', () => {
    expect(isExcludedProduct('anthropic')).toBe(true)
    expect(isExcludedProduct('openai')).toBe(true)
    expect(isExcludedProduct('codex')).toBe(false)
  })
})
