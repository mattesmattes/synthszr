/**
 * Begriffs-Repository (Task 5): Listen-/Matcher-Queries und Übersetzungs-
 * Fallback. Der Chain-Stub prüft, welche Constraints eine Query anwendet —
 * nicht (nur) den Rückgabewert. Muster aus
 * tests/lib/newsletter-access-tokens.test.ts:20-32.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  result: { data: [] as unknown, error: null as unknown },
  // Für Tests, die zwei aufeinanderfolgende Queries mit unterschiedlichen
  // Antworten brauchen (Basis-Zeile vs. Übersetzungs-Zeile): FIFO-Queue, die
  // bei Chain-Erzeugung konsumiert wird. Leer → Fallback auf `result`.
  queue: [] as unknown[],
  chains: [] as any[],
}))

function makeChain() {
  const chain: any = {}
  // 'in' ist nötig, weil applyTranslations .in('term_id', ids) nutzt.
  // 'range' ist nötig für die Paginierung in getChartProductNames.
  for (const m of ['select', 'eq', 'in', 'is', 'gt', 'order', 'limit', 'range', 'update', 'insert', 'delete']) {
    chain[m] = vi.fn(() => chain)
  }
  const own = state.queue.length ? state.queue.shift() : undefined
  const resolved = () => own ?? state.result
  chain.single = vi.fn(async () => resolved())
  chain.maybeSingle = vi.fn(async () => resolved())
  chain.then = (res: (v: unknown) => void) => res(resolved()) // await auf die Chain
  state.chains.push(chain)
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: vi.fn(() => makeChain()) }),
}))

beforeEach(() => {
  state.result = { data: [], error: null }
  state.queue.length = 0
  state.chains.length = 0
})

describe('getPublishedTermList', () => {
  it('selektiert kein body-JSONB', async () => {
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    await getPublishedTermList('de')
    const cols = state.chains[0].select.mock.calls[0][0] as string
    expect(cols).not.toContain('body')
    expect(cols).toContain('slug')
  })

  it('filtert auf status=published', async () => {
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    await getPublishedTermList('de')
    expect(state.chains[0].eq).toHaveBeenCalledWith('status', 'published')
  })

  it('übergibt term_ids an die Übersetzungsabfrage statt nur die Sprache', async () => {
    // Der PK ist (term_id, language) — ein Filter nur auf language nutzt den
    // Präfix nicht und läuft als Seq-Scan über alle Sprachen.
    state.result = { data: [{ id: 't1', slug: 's', canonical_name: 'N', summary: 'S' }], error: null }
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    await getPublishedTermList('en')
    const t9nChain = state.chains[1]
    expect(t9nChain.in).toHaveBeenCalledWith('term_id', ['t1'])
    expect(t9nChain.eq).toHaveBeenCalledWith('language', 'en')
  })

  it('gibt für lang=de keine id nach außen', async () => {
    state.result = { data: [{ id: 't1', slug: 's', canonical_name: 'N', summary: 'S' }], error: null }
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    const rows = await getPublishedTermList('de')
    expect(rows).toEqual([{ slug: 's', canonicalName: 'N', summary: 'S' }])
  })

  it('überschreibt Name/Summary mit der Übersetzung, wo eine existiert', async () => {
    state.queue = [
      { data: [{ id: 't1', slug: 's', canonical_name: 'N', summary: 'S' }], error: null }, // glossary_terms
      { data: [{ term_id: 't1', canonical_name: 'EN-Name', summary: 'EN-Summary' }], error: null }, // Übersetzung
    ]
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    const rows = await getPublishedTermList('en')
    expect(rows).toEqual([{ slug: 's', canonicalName: 'EN-Name', summary: 'EN-Summary' }])
  })

  it('behält die deutsche Fassung, wo keine Übersetzungszeile existiert', async () => {
    state.queue = [
      { data: [{ id: 't1', slug: 's', canonical_name: 'N', summary: 'S' }], error: null }, // glossary_terms
      { data: [], error: null }, // keine Übersetzung für t1
    ]
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    const rows = await getPublishedTermList('en')
    expect(rows).toEqual([{ slug: 's', canonicalName: 'N', summary: 'S' }])
  })

  it('degradiert bei DB-Fehler auf leere Liste statt zu werfen', async () => {
    state.result = { data: null, error: { message: 'boom' } }
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    const rows = await getPublishedTermList('de')
    expect(rows).toEqual([])
  })
})

describe('getMatcherTerms', () => {
  it('selektiert kein body-JSONB', async () => {
    const { getMatcherTerms } = await import('@/lib/glossary/terms')
    await getMatcherTerms('de')
    const cols = state.chains[0].select.mock.calls[0][0] as string
    expect(cols).not.toContain('body')
    expect(cols).toContain('aliases')
  })

  it('filtert auf status=published', async () => {
    const { getMatcherTerms } = await import('@/lib/glossary/terms')
    await getMatcherTerms('de')
    expect(state.chains[0].eq).toHaveBeenCalledWith('status', 'published')
  })

  it('gibt für lang=de keine id zurück', async () => {
    state.result = { data: [{ id: 't1', slug: 's', canonical_name: 'N', aliases: ['n'] }], error: null }
    const { getMatcherTerms } = await import('@/lib/glossary/terms')
    const rows = await getMatcherTerms('de')
    expect(rows).toEqual([{ slug: 's', canonicalName: 'N', aliases: ['n'] }])
  })

  it('übergibt term_ids an die Übersetzungsabfrage statt nur die Sprache', async () => {
    state.result = { data: [{ id: 't1', slug: 's', canonical_name: 'N', aliases: ['n'] }], error: null }
    const { getMatcherTerms } = await import('@/lib/glossary/terms')
    await getMatcherTerms('en')
    const t9nChain = state.chains[1]
    expect(t9nChain.in).toHaveBeenCalledWith('term_id', ['t1'])
    expect(t9nChain.eq).toHaveBeenCalledWith('language', 'en')
  })

  it('übernimmt Namen/Aliase der Zielsprache, wo eine Übersetzung existiert', async () => {
    state.queue = [
      { data: [{ id: 't1', slug: 's', canonical_name: 'N', aliases: ['n'] }], error: null },
      { data: [{ term_id: 't1', canonical_name: 'EN-N', aliases: ['en-n'] }], error: null },
    ]
    const { getMatcherTerms } = await import('@/lib/glossary/terms')
    const rows = await getMatcherTerms('en')
    expect(rows).toEqual([{ slug: 's', canonicalName: 'EN-N', aliases: ['en-n'] }])
  })

  it('degradiert bei DB-Fehler auf leere Liste statt zu werfen', async () => {
    state.result = { data: null, error: { message: 'boom' } }
    const { getMatcherTerms } = await import('@/lib/glossary/terms')
    const rows = await getMatcherTerms('de')
    expect(rows).toEqual([])
  })
})

describe('getChartProductNames', () => {
  it('selektiert nur canonical_name', async () => {
    state.result = { data: [{ canonical_name: 'Cursor' }], error: null }
    const { getChartProductNames } = await import('@/lib/glossary/terms')
    await getChartProductNames()
    expect(state.chains[0].select).toHaveBeenCalledWith('canonical_name')
  })

  it('filtert auf visibility_status=visible', async () => {
    state.result = { data: [], error: null }
    const { getChartProductNames } = await import('@/lib/glossary/terms')
    await getChartProductNames()
    expect(state.chains[0].eq).toHaveBeenCalledWith('visibility_status', 'visible')
  })

  it('paginiert über mehrere Seiten, weil PostgREST sonst bei 1000 kappt', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ canonical_name: `Produkt${i}` }))
    state.queue = [
      { data: page1, error: null },
      { data: [{ canonical_name: 'LetztesProdukt' }], error: null },
    ]
    const { getChartProductNames } = await import('@/lib/glossary/terms')
    const names = await getChartProductNames()
    expect(names).toHaveLength(1001)
    expect(names).toContain('LetztesProdukt')
    expect(state.chains[0].range).toHaveBeenCalledWith(0, 999)
    expect(state.chains[1].range).toHaveBeenCalledWith(1000, 1999)
  })

  it('degradiert bei DB-Fehler auf leere Liste statt zu werfen', async () => {
    state.result = { data: null, error: { message: 'boom' } }
    const { getChartProductNames } = await import('@/lib/glossary/terms')
    const names = await getChartProductNames()
    expect(names).toEqual([])
  })
})
