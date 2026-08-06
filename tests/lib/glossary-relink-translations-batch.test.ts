/**
 * relinkTranslationsNextBatch buendelt die Cursor-Orchestrierung um
 * relinkTranslationsBatch — dieselbe Bauart wie relinkNextBatch fuer die
 * deutschen Artikel, nur mit eigenem Cursor (translationsCursor), damit die
 * beiden Laeufe sich nicht gegenseitig zuruecksetzen.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ batch: vi.fn() }))

vi.mock('@/lib/glossary/backfill-translations', () => ({
  relinkTranslationsBatch: mocks.batch,
  TRANSLATIONS_PER_BATCH: 20,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.batch.mockResolvedValue({ linked: ['t1'], unchanged: 2, remaining: 5, cursor: 't9' })
})

describe('relinkTranslationsNextBatch', () => {
  it('reicht den gespeicherten Cursor an relinkTranslationsBatch weiter', async () => {
    const { relinkTranslationsNextBatch } = await import('@/lib/glossary/crawl')
    const supabase = makeSupabaseWithCrawlState({ translationsCursor: 'tc1' })

    const result = await relinkTranslationsNextBatch(supabase)

    expect(mocks.batch.mock.calls[0][1]).toBe('tc1')
    expect(result.linked).toEqual(['t1'])
  })

  it('schreibt den neuen Cursor zurueck, solange Zeilen offen sind', async () => {
    const { relinkTranslationsNextBatch } = await import('@/lib/glossary/crawl')
    const supabase = makeSupabaseWithCrawlState({ translationsCursor: 'tc1' })

    await relinkTranslationsNextBatch(supabase)

    expect(cursorWrittenTo(supabase)).toBe('t9')
  })

  it('setzt den Cursor auf null, wenn nichts mehr offen ist', async () => {
    // Sonst setzte der naechste Lauf mitten im Bestand auf, statt neue
    // Uebersetzungen von vorn zu pruefen.
    mocks.batch.mockResolvedValue({ linked: [], unchanged: 3, remaining: 0, cursor: 't9' })
    const { relinkTranslationsNextBatch } = await import('@/lib/glossary/crawl')
    const supabase = makeSupabaseWithCrawlState({ translationsCursor: 'tc1' })

    await relinkTranslationsNextBatch(supabase)

    expect(cursorWrittenTo(supabase)).toBeNull()
  })

  it('laesst den relink-Cursor der deutschen Artikel unangetastet', async () => {
    // Beide Laeufe teilen sich die settings-Zeile; ein Schreibvorgang darf den
    // jeweils anderen Fortschritt nicht verwerfen.
    const { relinkTranslationsNextBatch } = await import('@/lib/glossary/crawl')
    const supabase = makeSupabaseWithCrawlState({ translationsCursor: 'tc1', relinkCursor: 'rc-behalten' })

    await relinkTranslationsNextBatch(supabase)

    const written = lastWrittenState(supabase)
    expect(written.relinkCursor).toBe('rc-behalten')
  })
})

function makeSupabaseWithCrawlState(state: { translationsCursor: string | null; relinkCursor?: string | null }) {
  const writes: Array<Record<string, unknown>> = []
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({
      data: {
        value: {
          translationsCursor: state.translationsCursor,
          relinkCursor: state.relinkCursor ?? null,
          candidates: {}, generated: [], excluded: [],
        },
      },
      error: null,
    }),
    single: async () => ({ data: null, error: null }),
    update: (payload: Record<string, unknown>) => { writes.push(payload); return chain },
    upsert: (payload: Record<string, unknown>) => { writes.push(payload); return chain },
    insert: () => chain,
    then: (res: (v: unknown) => void) => res({ data: null, error: null }),
  }
  return { from: () => chain, __writes: writes } as any
}

function lastWrittenState(supabase: any): Record<string, unknown> {
  for (const w of [...supabase.__writes].reverse()) {
    const s = (w.value ?? w) as Record<string, unknown>
    if ('translationsCursor' in s) return s
  }
  return {}
}

function cursorWrittenTo(supabase: any): string | null | undefined {
  const s = lastWrittenState(supabase)
  return 'translationsCursor' in s ? (s.translationsCursor as string | null) : undefined
}
