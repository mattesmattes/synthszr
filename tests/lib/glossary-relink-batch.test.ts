/**
 * relinkNextBatch buendelt die Orchestrierung, die bisher inline im
 * Route-Zweig action=relink lag: Begriffe laden, reservierte Namen bauen,
 * Cursor lesen und zurueckschreiben. Die Verlinkungsarbeit selbst steckte
 * schon in backfillGlossaryLinks — nur war sie vom Cron aus nicht erreichbar.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  backfill: vi.fn(),
  matcherTerms: vi.fn(),
  chartNames: vi.fn(),
  readState: vi.fn(),
  writeCursor: vi.fn(),
}))

vi.mock('@/lib/glossary/backfill', () => ({ backfillGlossaryLinks: mocks.backfill }))
vi.mock('@/lib/glossary/terms', () => ({
  getMatcherTerms: mocks.matcherTerms,
  buildReservedNames: (n: string[]) => n,
  getChartProductNames: mocks.chartNames,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.matcherTerms.mockResolvedValue([{ slug: 'transformer', canonicalName: 'Transformer', aliases: [] }])
  mocks.chartNames.mockResolvedValue(['GPT-5'])
  mocks.backfill.mockResolvedValue({ linked: ['a'], unchanged: 2, remaining: 5, cursor: 'c2' })
})

describe('relinkNextBatch', () => {
  it('reicht den gespeicherten Cursor an backfillGlossaryLinks weiter', async () => {
    const { relinkNextBatch } = await import('@/lib/glossary/crawl')
    const supabase = makeSupabaseWithCrawlState({ relinkCursor: 'c1' })

    const result = await relinkNextBatch(supabase, { since: null })

    expect(mocks.backfill.mock.calls[0][3]).toBe('c1')
    expect(result.linked).toEqual(['a'])
  })

  it('schreibt den neuen Cursor zurueck, solange Artikel offen sind', async () => {
    const { relinkNextBatch } = await import('@/lib/glossary/crawl')
    const supabase = makeSupabaseWithCrawlState({ relinkCursor: 'c1' })

    await relinkNextBatch(supabase, { since: null })

    expect(cursorWrittenTo(supabase)).toBe('c2')
  })

  it('setzt den Cursor auf null, wenn nichts mehr offen ist', async () => {
    // Sonst wuerde der naechste Lauf mitten im Bestand weitermachen statt von
    // vorn zu pruefen.
    mocks.backfill.mockResolvedValue({ linked: [], unchanged: 3, remaining: 0, cursor: 'c9' })
    const { relinkNextBatch } = await import('@/lib/glossary/crawl')
    const supabase = makeSupabaseWithCrawlState({ relinkCursor: 'c1' })

    await relinkNextBatch(supabase, { since: null })

    expect(cursorWrittenTo(supabase)).toBeNull()
  })

  it('wirft, wenn die Begriffsliste nicht ladbar ist', async () => {
    // Ohne Begriffe wuerde der Lauf jeden Artikel als "nichts zu verlinken"
    // abhaken und den Bestand stillschweigend durchbrennen.
    mocks.matcherTerms.mockResolvedValue(null)
    const { relinkNextBatch } = await import('@/lib/glossary/crawl')
    const supabase = makeSupabaseWithCrawlState({ relinkCursor: null })

    await expect(relinkNextBatch(supabase, { since: null })).rejects.toThrow(/Begriffsliste/)
  })
})

/**
 * Minimaler Supabase-Doppelgaenger: nur der Crawl-State wird gelesen/geschrieben.
 *
 * Abweichung vom Brief: readCrawlState liest `data.value` (Spalte `value` der
 * Tabelle `settings`), nicht `data.state` — und writeCrawlState schreibt per
 * `upsert({ key, value })`, nicht per `update`. maybeSingle() und upsert()
 * bilden deshalb `value` nach, sonst wuerde readCrawlState den Mock-Zustand gar
 * nicht sehen (parsed waere `undefined`, Fallback auf EMPTY_STATE) und jeder
 * Test liefe am eigentlichen Cursor vorbei.
 */
function makeSupabaseWithCrawlState(state: { relinkCursor: string | null }) {
  const writes: Array<Record<string, unknown>> = []
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: { value: { relinkCursor: state.relinkCursor, candidates: {}, generated: [], excluded: [] } }, error: null }),
    single: async () => ({ data: null, error: null }),
    update: (payload: Record<string, unknown>) => { writes.push(payload); return chain },
    upsert: (payload: Record<string, unknown>) => { writes.push(payload); return chain },
    insert: () => chain,
    then: (res: (v: unknown) => void) => res({ data: null, error: null }),
  }
  return { from: () => chain, __writes: writes } as any
}

/**
 * Der zuletzt geschriebene relinkCursor, egal ob update oder upsert.
 *
 * Abweichung vom Brief: der Cursor steckt im `value`-Feld des upsert-Payloads
 * (`{ key, value: { ...state, relinkCursor } }`), nicht direkt oder unter
 * `state` — daher `w.value ?? w` statt `w.state ?? w`.
 */
function cursorWrittenTo(supabase: any): string | null | undefined {
  for (const w of [...supabase.__writes].reverse()) {
    const s = (w.value ?? w) as Record<string, unknown>
    if ('relinkCursor' in s) return s.relinkCursor as string | null
  }
  return undefined
}
