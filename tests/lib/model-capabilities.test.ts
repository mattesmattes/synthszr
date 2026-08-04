/**
 * Modell-Capabilities für die Anthropic-Calls (Thinking-Form, effort,
 * temperature). Vorher eine ALLOWLIST inline in ghostwriter-pipeline.ts — ein
 * neues Modell, das dort fehlte, bekam `thinking.budget_tokens` und wurde mit
 * HTTP 400 abgelehnt. Am 2026-08-04 in Prod passiert (claude-opus-5): jeder
 * Abschnitt des Tages-Artikels wurde durch die Fehlermeldung ersetzt.
 *
 * Der Fehlermodus ist asymmetrisch, deshalb ist die Struktur jetzt umgekehrt:
 *   modernes Modell fälschlich als alt behandelt -> HTTP 400, Totalausfall
 *   altes Modell fälschlich als modern behandelt  -> denkt nicht, Text kommt
 * Unbekannte Modelle gelten daher als modern; nur die bekannten Abweichler
 * stehen in den Denylists.
 *
 * Die Tabelle unten ist eine REGRESSIONSTABELLE: sie fixiert für jedes Modell,
 * das das Projekt heute nutzen kann, exakt die Flags, die die alte
 * Allowlist-Logik ergab. Die Umstellung darf für bekannte Modelle NICHTS ändern.
 */
import { describe, expect, it } from 'vitest'
import { getModelCapabilities } from '@/lib/claude/model-capabilities'

// [modelId, adaptiveThinking, supportsEffort, rejectsSampling]
const KNOWN: Array<[string, boolean, boolean, boolean]> = [
  // 2026er Frontier: adaptives Thinking, effort, lehnen temperature ab
  ['claude-opus-5', true, true, true],
  ['claude-sonnet-5', true, true, true],
  ['claude-fable-5', true, true, true],
  ['claude-mythos-5', true, true, true],
  // Opus 4.7/4.8: adaptiv + effort, lehnen sampling ab
  ['claude-opus-4-8', true, true, true],
  ['claude-opus-4-7', true, true, true],
  // Opus 4.6: adaptiv + effort, akzeptiert temperature
  ['claude-opus-4-6', true, true, false],
  // Opus 4.5: NOCH budget_tokens, aber schon effort
  ['claude-opus-4-5', false, true, false],
  // Sonnet 4.6: adaptiv + effort, akzeptiert temperature
  ['claude-sonnet-4-6', true, true, false],
  // Sonnet 4.5 / Haiku 4.5: alte Form, kein effort
  ['claude-sonnet-4-5', false, false, false],
  ['claude-haiku-4-5-20251001', false, false, false],
]

describe('getModelCapabilities', () => {
  it.each(KNOWN)(
    '%s behält die Flags der bisherigen Allowlist-Logik',
    (id, adaptiveThinking, supportsEffort, rejectsSampling) => {
      expect(getModelCapabilities(id)).toEqual({ adaptiveThinking, supportsEffort, rejectsSampling })
    },
  )

  it('behandelt ein UNBEKANNTES Modell als modern statt als alt', () => {
    // Der Kern des Fixes: genau hier brach die Allowlist. Ein Modell, das
    // niemand eingetragen hat, darf kein budget_tokens bekommen.
    const caps = getModelCapabilities('claude-opus-6')
    expect(caps.adaptiveThinking).toBe(true)
    expect(caps.rejectsSampling).toBe(true)
  })

  it('behandelt auch ein unbekanntes Sonnet/Haiku der Zukunft als modern', () => {
    expect(getModelCapabilities('claude-sonnet-7').adaptiveThinking).toBe(true)
    expect(getModelCapabilities('claude-haiku-6').adaptiveThinking).toBe(true)
  })

  it('behandelt die alte claude-3-Familie weiter als alt', () => {
    // Gegenprobe zur Denylist: ohne sie würde ein claude-3-Modell adaptives
    // Thinking angeboten bekommen, das es nicht kennt.
    expect(getModelCapabilities('claude-3-5-sonnet-20241022')).toEqual({
      adaptiveThinking: false, supportsEffort: false, rejectsSampling: false,
    })
  })
})
