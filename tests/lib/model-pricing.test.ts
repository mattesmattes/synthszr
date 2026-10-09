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

  // Betreiber-Vorgabe 2026-10-05 (Spec Morgenkonferenz, „Kosten"): Phase 0 pflegt
  // opus-5-5, fable-5-1, mythos-5-1 nach — bis dahin liefen Aufrufe damit mit
  // cost_usd = NULL. Preise = externes Datum von
  // https://platform.claude.com/docs/en/about-claude/pricing, gelesen 2026-10-07.
  it('enthält claude-fable-5-1 mit korrektem Preis', () => {
    expect(MODEL_PRICING['claude-fable-5-1']).toBeDefined()
    expect(MODEL_PRICING['claude-fable-5-1'].pricing).toEqual({ input: 10, output: 50 })
    expect(MODEL_PRICING['claude-fable-5-1'].provider).toBe('anthropic')
  })

  it('enthält claude-mythos-5-1 mit korrektem Preis', () => {
    expect(MODEL_PRICING['claude-mythos-5-1']).toBeDefined()
    expect(MODEL_PRICING['claude-mythos-5-1'].pricing).toEqual({ input: 10, output: 50 })
    expect(MODEL_PRICING['claude-mythos-5-1'].provider).toBe('anthropic')
  })

  it('enthält claude-opus-5-5 mit korrektem Preis', () => {
    expect(MODEL_PRICING['claude-opus-5-5']).toBeDefined()
    expect(MODEL_PRICING['claude-opus-5-5'].pricing).toEqual({ input: 4, output: 20 })
    expect(MODEL_PRICING['claude-opus-5-5'].provider).toBe('anthropic')
  })

  // Vertrag 2.9 (Phase 0): PRICING_LAST_UPDATED ist der Tag, an dem die drei
  // Einträge gepflegt wurden — der Test oben („nicht in der Zukunft") lässt den
  // alten Wert 2026-08-03 sonst stehen. Untergrenze = Planungstag; der
  // Umsetzungstag liegt nie davor.
  it('PRICING_LAST_UPDATED wurde mit den Phase-0-Einträgen angehoben', () => {
    expect(new Date(PRICING_LAST_UPDATED).getTime())
      .toBeGreaterThanOrEqual(new Date('2026-10-06').getTime())
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
