/**
 * getPublishedTermList: Pagination und Spaltenwahl.
 *
 * Beides zaehlt erst bei Bestand: heute 17 Begriffe, aber die Funktion laeuft in
 * JEDER Begriffsseite. Zwei bekannte Fallen dieses Projekts treffen hier
 * zusammen — das stille 1000er-Cap von PostgREST (hat bei den Company-Mentions
 * 34% der Zeilen verschluckt) und breite Selects in Listen-Queries (Ursache der
 * Egress-Overage).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { resetGlossaryTermsCachesForTests } from '@/lib/glossary/terms'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from }) }))

// Sonst profitiert ein Testfall vom Ergebnis eines frueheren, weil
// getPublishedTermList seit 2026-08-19 modulweit fuer 10 Minuten cacht.
beforeEach(() => {
  resetGlossaryTermsCachesForTests()
})

/** Fake-PostgREST mit range()-Unterstuetzung, das seitenweise ausliefert. */
function fakeTable(allRows: Array<Record<string, unknown>>) {
  const calls: { selects: string[]; ranges: Array<[number, number]> } = { selects: [], ranges: [] }
  const chain: Record<string, unknown> = {
    select: vi.fn((cols: string) => { calls.selects.push(cols); return chain }),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    in: vi.fn(() => Promise.resolve({ data: [], error: null })),
    range: vi.fn((from: number, to: number) => {
      calls.ranges.push([from, to])
      return Promise.resolve({ data: allRows.slice(from, to + 1), error: null })
    }),
  }
  mocks.from.mockReturnValue(chain)
  return calls
}

const row = (i: number) => ({
  id: `id-${i}`, slug: `t-${i}`, canonical_name: `Term ${i}`, summary: `Summary ${i}`,
})

describe('getPublishedTermList', () => {
  it('holt ALLE Zeilen ueber das 1000er-Cap hinaus', async () => {
    // Ohne Pagination lieferte PostgREST stillschweigend 1000 Zeilen und die
    // Begriffe ab 1001 waeren aus Register und Sitemap verschwunden — ohne Fehler.
    const calls = fakeTable(Array.from({ length: 1200 }, (_, i) => row(i)))
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    const terms = await getPublishedTermList('de')
    expect(terms).toHaveLength(1200)
    expect(calls.ranges.length).toBeGreaterThan(1)
  })

  it('hoert auf zu blaettern, wenn eine Seite nicht mehr voll ist', async () => {
    const calls = fakeTable(Array.from({ length: 30 }, (_, i) => row(i)))
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    await getPublishedTermList('de')
    expect(calls.ranges).toHaveLength(1)
  })

  it('laedt das summary NICHT, wenn es nicht angefordert wird', async () => {
    // Das Register in der Seitenspalte braucht nur Slug und Name. Bei 500
    // Begriffen sind das rund 20 KB statt 120 KB je Seitenaufbau.
    const calls = fakeTable([row(0)])
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    await getPublishedTermList('de', { includeSummary: false })
    expect(calls.selects[0]).not.toContain('summary')
    expect(calls.selects[0]).toContain('slug')
  })

  it('laedt das summary standardmaessig weiter mit', async () => {
    // Die Index-Seite zeigt es an; ein stiller Wegfall waere eine Regression.
    const calls = fakeTable([row(0)])
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    const terms = await getPublishedTermList('de')
    expect(calls.selects[0]).toContain('summary')
    expect(terms[0].summary).toBe('Summary 0')
  })

  it('gibt bei einem Fehler eine leere Liste zurueck', async () => {
    const chain: Record<string, unknown> = {
      select: () => chain, eq: () => chain, order: () => chain,
      range: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
    }
    mocks.from.mockReturnValue(chain)
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    await expect(getPublishedTermList('de')).resolves.toEqual([])
  })
})
