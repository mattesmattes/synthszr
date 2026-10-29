/**
 * Leere Skript-Antworten erklaeren (Befund 2026-10-29: Opus 5.5 lieferte
 * „AI generated empty script" ohne Hinweis, ob Verweigerung, Denkbudget oder
 * leerer Textblock). Die Meldung muss stop_reason und Blocktypen nennen.
 */
import { describe, expect, it } from 'vitest'
import { describeEmptyScript, extractScriptText, scriptRequestBudget, fallbackModelFor, shouldRetryWithFallback } from '@/lib/podcast/script-diagnostics'

describe('extractScriptText', () => {
  it('verbindet nur Textbloecke', () => {
    expect(extractScriptText({ content: [{ type: 'thinking' }, { type: 'text', text: 'A' }, { type: 'text', text: 'B' }] })).toBe('A\nB')
    expect(extractScriptText({ content: [{ type: 'thinking' }] })).toBe('')
  })
})

describe('describeEmptyScript', () => {
  it('nennt Verweigerung', () => {
    expect(describeEmptyScript({ stop_reason: 'refusal', content: [] }, 12000)).toMatch(/verweigert/i)
  })
  it('nennt ein aufgebrauchtes Budget, wenn nur gedacht wurde', () => {
    const m = describeEmptyScript({ stop_reason: 'max_tokens', content: [{ type: 'thinking' }], usage: { output_tokens: 12000 } }, 12000)
    expect(m).toMatch(/Denken/)
    expect(m).toContain('12000')
  })
  it('nennt stop_reason und Blocktypen im Restfall', () => {
    const m = describeEmptyScript({ stop_reason: 'end_turn', content: [{ type: 'thinking' }], usage: { output_tokens: 35 } }, 12000)
    expect(m).toContain('end_turn')
    expect(m).toContain('thinking')
    expect(m).toContain('35')
  })
})

// --- Befund 2026-10-29: Opus 5.5 verweigert beim Denken (refusal), Opus 5 mit
// abgeschaltetem Denken nicht. Ein Wiederholungslauf mit Rueckfallmodell
// rettet den manuellen Lauf, ohne das Hauptmodell zu wechseln.
describe('scriptRequestBudget', () => {
  it('schaltet Denken ab, wo das Modell es erlaubt, und laesst max_tokens unveraendert', () => {
    expect(scriptRequestBudget('claude-opus-5', 12000)).toEqual({ max_tokens: 12000, thinking: { type: 'disabled' } })
  })
  it('gibt Modellen ohne abschaltbares Denken Spielraum fuer das Denken', () => {
    expect(scriptRequestBudget('claude-opus-5-5', 12000)).toEqual({ max_tokens: 20000 })
  })
})

describe('fallbackModelFor / shouldRetryWithFallback', () => {
  it('faellt von Opus 5.5 auf Opus 5 zurueck, von Opus 5 auf nichts', () => {
    expect(fallbackModelFor('claude-opus-5-5')).toBe('claude-opus-5')
    expect(fallbackModelFor('claude-opus-5')).toBeNull()
  })
  it('wiederholt bei Verweigerung und bei verbrauchtem Denkbudget, sonst nicht', () => {
    expect(shouldRetryWithFallback({ stop_reason: 'refusal', content: [] })).toBe(true)
    expect(shouldRetryWithFallback({ stop_reason: 'max_tokens', content: [{ type: 'thinking' }] })).toBe(true)
    expect(shouldRetryWithFallback({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'halb' }] })).toBe(false)
    expect(shouldRetryWithFallback({ stop_reason: 'end_turn', content: [] })).toBe(false)
  })
})
