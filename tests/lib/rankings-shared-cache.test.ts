/**
 * getRankedProductsShared: Redis-Schicht vor der Charts-Übersicht und dem
 * Kategorie-Rang der Produktseiten (Egress-Befund 2026-09-19: ein Crawler
 * rief /rankings ~260×/h ungecacht auf, je ~470 KB aus product_metrics).
 *
 * Das Risiko dieser Schicht ist der Schlüssel: zwei Ansichten, die sich einen
 * Eintrag teilen, zeigen still die falsche Liste (Kategorie A unter der URL
 * von Kategorie B). Das Verhalten von withSharedCache selbst (Degradation,
 * Namensraum, leere Listen) deckt glossary-shared-cache.test.ts ab.
 */
import { describe, expect, it } from 'vitest'
import { rankedProductsCacheKey } from '@/lib/rankings/leaderboard'

describe('rankedProductsCacheKey', () => {
  it('trennt jede Option, die das Ergebnis verändert', () => {
    const base = { limit: 100, minMentions: 2 }
    const keys = [
      rankedProductsCacheKey(base),
      rankedProductsCacheKey({ ...base, limit: 50 }),
      rankedProductsCacheKey({ ...base, minMentions: 1 }),
      rankedProductsCacheKey({ ...base, includeHistory: false }),
      rankedProductsCacheKey({ ...base, category: 'coding' }),
      rankedProductsCacheKey({ ...base, category: 'chat' }),
      rankedProductsCacheKey({ ...base, categoryIn: ['coding', 'chat'] }),
      rankedProductsCacheKey({ ...base, categoryIn: ['coding'] }),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('verwechselt category nicht mit einer einelementigen categoryIn-Liste', () => {
    expect(rankedProductsCacheKey({ category: 'coding' }))
      .not.toBe(rankedProductsCacheKey({ categoryIn: ['coding'] }))
  })

  it('nimmt die Defaults von getRankedProducts, damit gleiche Abfragen einen Eintrag teilen', () => {
    // getRankedProducts: minMentions = 1, includeHistory = true
    expect(rankedProductsCacheKey({ limit: 100 }))
      .toBe(rankedProductsCacheKey({ limit: 100, minMentions: 1, includeHistory: true }))
  })

  it('ignoriert die Reihenfolge von categoryIn (gleiche Menge = gleiches Ergebnis)', () => {
    expect(rankedProductsCacheKey({ categoryIn: ['a', 'b'] }))
      .toBe(rankedProductsCacheKey({ categoryIn: ['b', 'a'] }))
  })
})
