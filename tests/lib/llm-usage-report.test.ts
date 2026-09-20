/**
 * Auswertung des Token-Protokolls für die Admin-Ansicht.
 *
 * Der Zweck der ganzen Übung (Betreiber-Frage 2026-09-20) ist die Rangliste
 * nach Use Case: "welcher Job kostet mich die 44 $ am Tag?". Deshalb ist die
 * Sortierung nach Kosten Teil des Vertrags, nicht Deko.
 */
import { describe, expect, it } from 'vitest'
import { aggregateUsage, type UsageRow } from '@/lib/ai/usage-report'

const row = (over: Partial<UsageRow>): UsageRow => ({
  created_at: '2026-09-20T05:00:00Z',
  use_case: 'ghostwriter',
  model: 'claude-opus-5',
  input_tokens: 1000,
  output_tokens: 2000,
  cache_write_tokens: 0,
  cache_read_tokens: 0,
  cost_usd: 1,
  ...over,
})

describe('aggregateUsage', () => {
  it('summiert Kosten, Aufrufe und Token je Use Case, teuerster zuerst', () => {
    const r = aggregateUsage([
      row({ use_case: 'glossary_generation', cost_usd: 0.5 }),
      row({ use_case: 'ghostwriter', cost_usd: 2 }),
      row({ use_case: 'ghostwriter', cost_usd: 3, output_tokens: 5000 }),
    ])
    expect(r.byUseCase.map((u) => u.useCase)).toEqual(['ghostwriter', 'glossary_generation'])
    expect(r.byUseCase[0]).toMatchObject({ calls: 2, costUsd: 5, outputTokens: 7000 })
    expect(r.totalCostUsd).toBe(5.5)
    expect(r.totalCalls).toBe(3)
  })

  it('gruppiert nach Modell und nach Tag (UTC)', () => {
    const r = aggregateUsage([
      row({ created_at: '2026-09-19T23:59:00Z', cost_usd: 1 }),
      row({ created_at: '2026-09-20T00:01:00Z', cost_usd: 2, model: 'claude-sonnet-5' }),
    ])
    expect(r.byDay).toEqual([
      { day: '2026-09-19', costUsd: 1, calls: 1 },
      { day: '2026-09-20', costUsd: 2, calls: 1 },
    ])
    expect(r.byModel.map((m) => m.model)).toEqual(['claude-sonnet-5', 'claude-opus-5'])
  })

  it('behandelt cost_usd = null als 0, zählt den Aufruf aber mit', () => {
    // null heisst "Modell fehlt in der Preistabelle" — die Zeile darf die Summe
    // nicht verfälschen, aber auch nicht unsichtbar werden.
    const r = aggregateUsage([row({ cost_usd: null, use_case: 'enrich' })])
    expect(r.totalCostUsd).toBe(0)
    expect(r.byUseCase[0]).toMatchObject({ useCase: 'enrich', calls: 1, costUsd: 0, unpricedCalls: 1 })
  })

  it('kommt mit einer leeren Tabelle klar', () => {
    expect(aggregateUsage([])).toMatchObject({ totalCostUsd: 0, totalCalls: 0, byUseCase: [], byModel: [], byDay: [] })
  })
})
