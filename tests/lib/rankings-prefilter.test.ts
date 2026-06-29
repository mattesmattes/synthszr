import { describe, it, expect } from 'vitest'
import { looksAiProductRelevant } from '@/lib/rankings/prefilter'

describe('looksAiProductRelevant', () => {
  it('erkennt News mit generischem AI-Begriff', () => {
    expect(looksAiProductRelevant('OpenAI ships GPT-5.6', 'The new model is faster')).toBe(true)
  })
  it('erkennt News mit bekanntem Vendor', () => {
    expect(looksAiProductRelevant('Anthropic announcement', 'a new release today')).toBe(true)
  })
  it('erkennt LLM/Modell-Begriffe im Inhalt', () => {
    expect(looksAiProductRelevant('Weekly digest', 'a new language model was benchmarked')).toBe(true)
  })
  it('verwirft reine Nicht-AI-News', () => {
    expect(looksAiProductRelevant('Billionaire battle over yachts', 'Two CEOs argue about boats')).toBe(false)
    expect(looksAiProductRelevant('Subscribe to our newsletter', 'Get weekly updates in your inbox')).toBe(false)
  })
  it('ist case-insensitive', () => {
    expect(looksAiProductRelevant('CLAUDE update', '')).toBe(true)
  })
  it('leere Eingabe ist nicht relevant', () => {
    expect(looksAiProductRelevant('', '')).toBe(false)
  })
})
