import { describe, expect, it } from 'vitest'
import { MODEL_PRICING, PRICING_LAST_UPDATED } from '@/lib/ai/model-pricing'
import { USE_CASE_DEFINITIONS } from '@/lib/ai/use-cases'

describe('MODEL_PRICING — aktuelle Anthropic-Modelle', () => {
  it('enthält claude-opus-5 mit korrektem Preis und Kontextfenster', () => {
    expect(MODEL_PRICING['claude-opus-5']).toBeDefined()
    expect(MODEL_PRICING['claude-opus-5'].pricing).toEqual({ input: 5, output: 25 })
    expect(MODEL_PRICING['claude-opus-5'].provider).toBe('anthropic')
  })

  it('enthält claude-sonnet-5 mit korrektem Preis', () => {
    expect(MODEL_PRICING['claude-sonnet-5']).toBeDefined()
    expect(MODEL_PRICING['claude-sonnet-5'].pricing).toEqual({ input: 3, output: 15 })
    expect(MODEL_PRICING['claude-sonnet-5'].provider).toBe('anthropic')
  })

  it('enthält claude-haiku-4-5-20251001 mit korrektem Preis', () => {
    expect(MODEL_PRICING['claude-haiku-4-5-20251001']).toBeDefined()
    expect(MODEL_PRICING['claude-haiku-4-5-20251001'].pricing).toEqual({ input: 1, output: 5 })
  })

  it('enthält claude-fable-5 mit korrektem Preis', () => {
    expect(MODEL_PRICING['claude-fable-5']).toBeDefined()
    expect(MODEL_PRICING['claude-fable-5'].pricing).toEqual({ input: 10, output: 50 })
    expect(MODEL_PRICING['claude-fable-5'].provider).toBe('anthropic')
  })

  it('PRICING_LAST_UPDATED ist ein gültiges Datum und nicht in der Zukunft', () => {
    const parsed = new Date(PRICING_LAST_UPDATED)
    expect(Number.isNaN(parsed.getTime())).toBe(false)
    expect(parsed.getTime()).toBeLessThanOrEqual(Date.now())
  })
})

describe('USE_CASE_DEFINITIONS × MODEL_PRICING — Integrität', () => {
  it('jedes als Anthropic-Default konfigurierte Modell hat einen Preis-Eintrag', () => {
    const missing: string[] = []
    for (const [useCase, info] of Object.entries(USE_CASE_DEFINITIONS)) {
      const isAnthropicModel = info.defaultModel.startsWith('claude-')
      if (!isAnthropicModel) continue
      if (!MODEL_PRICING[info.defaultModel]) {
        missing.push(`${useCase} → ${info.defaultModel}`)
      }
    }
    expect(missing).toEqual([])
  })
})
