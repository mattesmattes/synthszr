import { describe, it, expect } from 'vitest'
import { momentumScore, toDisplayScore, momentumHistory } from '@/lib/rankings/score'

const NOW = new Date('2026-06-29T12:00:00Z')

describe('momentumScore', () => {
  it('keine Mentions → 0', () => {
    expect(momentumScore([], NOW)).toBe(0)
  })
  it('eine frische Mention (heute) ≈ 1', () => {
    expect(momentumScore(['2026-06-29T10:00:00Z'], NOW)).toBeCloseTo(1, 1)
  })
  it('Mention vor einer Halbwertszeit (14 Tage) ≈ 0.5', () => {
    expect(momentumScore(['2026-06-15T12:00:00Z'], NOW)).toBeCloseTo(0.5, 1)
  })
  it('mehr Mentions → höherer Score', () => {
    const one = momentumScore(['2026-06-29T10:00:00Z'], NOW)
    const three = momentumScore(['2026-06-29T10:00:00Z', '2026-06-28T10:00:00Z', '2026-06-27T10:00:00Z'], NOW)
    expect(three).toBeGreaterThan(one)
  })
  it('jüngere Mentions zählen mehr als ältere', () => {
    const recent = momentumScore(['2026-06-28T12:00:00Z'], NOW)
    const old = momentumScore(['2026-05-01T12:00:00Z'], NOW)
    expect(recent).toBeGreaterThan(old)
  })
  it('ignoriert Zukunfts-Datumsangaben', () => {
    expect(momentumScore(['2026-12-31T12:00:00Z'], NOW)).toBe(0)
  })
})

describe('momentumHistory', () => {
  it('liefert die angeforderte Anzahl Stützstellen, aufsteigend in der Zeit', () => {
    const h = momentumHistory(['2026-06-20T12:00:00Z'], NOW, 21, 8)
    expect(h).toHaveLength(8)
    expect(h[0].t).toBeLessThan(h[7].t)
    expect(h[7].t).toBe(NOW.getTime())
  })
  it('Momentum steigt, wenn Mentions hinzukommen (frühe Stützstelle < späte)', () => {
    // zwei Mentions kurz vor jetzt → frühe Stützstellen 0, späte > 0
    const h = momentumHistory(['2026-06-27T12:00:00Z', '2026-06-28T12:00:00Z'], NOW, 21, 12)
    expect(h[0].value).toBe(0)
    expect(h[h.length - 1].value).toBeGreaterThan(0)
  })
  it('leere Mentions → alle Werte 0', () => {
    expect(momentumHistory([], NOW, 21, 5).every((p) => p.value === 0)).toBe(true)
  })
})

describe('toDisplayScore', () => {
  it('Top-Produkt bekommt 100', () => {
    expect(toDisplayScore(8, 8)).toBe(100)
  })
  it('halbes Momentum → 50', () => {
    expect(toDisplayScore(4, 8)).toBe(50)
  })
  it('max=0 → 0 (kein Division-durch-Null)', () => {
    expect(toDisplayScore(0, 0)).toBe(0)
  })
})
