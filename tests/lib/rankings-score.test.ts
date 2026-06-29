import { describe, it, expect } from 'vitest'
import { momentumScore, toDisplayScore } from '@/lib/rankings/score'

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
