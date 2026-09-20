/**
 * Kostenrechnung je Modellaufruf (Betreiber-Frage 2026-09-20: „woher kommen
 * die täglichen Opus-5-Kosten?" — ohne Logging war das nur schätzbar).
 *
 * Die beiden Fallen, die diese Tests festhalten:
 * 1. Thinking-Token zählen als OUTPUT. Bei Opus 5 mit effort:high ist das der
 *    größte Posten, und `usage.output_tokens` enthält sie bereits — es darf
 *    also nichts extra addiert werden, aber der Output-Preis muss gelten.
 * 2. Cache-Token haben eigene Preise (Schreiben 1,25x, Lesen 0,1x Input). Wer
 *    sie wie normale Input-Token abrechnet, überschätzt den Ghostwriter grob,
 *    weil dessen Prefix über alle Abschnitte gecacht wird.
 */
import { describe, expect, it } from 'vitest'
import { computeCostUsd, extractUsage } from '@/lib/ai/usage-cost'

describe('extractUsage', () => {
  it('liest die Anthropic-Felder inklusive Cache', () => {
    expect(extractUsage({
      input_tokens: 100, output_tokens: 200,
      cache_creation_input_tokens: 300, cache_read_input_tokens: 400,
    })).toEqual({ inputTokens: 100, outputTokens: 200, cacheWriteTokens: 300, cacheReadTokens: 400 })
  })

  it('behandelt fehlende Felder als 0 statt NaN', () => {
    expect(extractUsage({ input_tokens: 10 })).toEqual({
      inputTokens: 10, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0,
    })
  })

  it('gibt null zurück, wenn gar kein usage-Objekt kam', () => {
    expect(extractUsage(undefined)).toBeNull()
    expect(extractUsage(null)).toBeNull()
    expect(extractUsage('kaputt')).toBeNull()
  })
})

describe('computeCostUsd', () => {
  const opus = (u: Partial<Parameters<typeof computeCostUsd>[1]>) =>
    computeCostUsd('claude-opus-5', { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, ...u })

  it('rechnet Input und Output mit den Modellpreisen', () => {
    // Opus 5: 5 $/Mio Input, 25 $/Mio Output
    expect(opus({ inputTokens: 1_000_000 })).toBeCloseTo(5, 6)
    expect(opus({ outputTokens: 1_000_000 })).toBeCloseTo(25, 6)
  })

  it('rechnet Cache-Schreiben mit 1,25x und Cache-Lesen mit 0,1x Input', () => {
    expect(opus({ cacheWriteTokens: 1_000_000 })).toBeCloseTo(6.25, 6)
    expect(opus({ cacheReadTokens: 1_000_000 })).toBeCloseTo(0.5, 6)
  })

  it('summiert alle vier Posten', () => {
    expect(opus({ inputTokens: 2000, outputTokens: 8000, cacheWriteTokens: 20_000, cacheReadTokens: 400_000 }))
      .toBeCloseTo(2000 * 5e-6 + 8000 * 25e-6 + 20_000 * 6.25e-6 + 400_000 * 0.5e-6, 9)
  })

  it('gibt null für ein unbekanntes Modell zurück, statt 0 vorzutäuschen', () => {
    expect(computeCostUsd('irgendein-neues-modell', {
      inputTokens: 1000, outputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0,
    })).toBeNull()
  })

  it('kennt auch die Nicht-Anthropic-Modelle aus der Preistabelle', () => {
    expect(computeCostUsd('claude-haiku-4-5-20251001', {
      inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0,
    })).toBeGreaterThan(0)
  })
})
