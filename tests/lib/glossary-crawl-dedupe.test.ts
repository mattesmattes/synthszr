/**
 * generateCandidates: ein Kandidat, der nur NORMALISIERT (nicht exakt) mit
 * einem bestehenden Begriff kollidiert, darf weder erzeugt noch bei jedem
 * weiteren Lauf erneut versucht werden.
 *
 * Befund 2026-08-06: "Eval"/"Evals", "Pretraining"/"Pre-Training" usw. ergeben
 * unterschiedliche exakte Slugs, wurden deshalb beide erzeugt UND bezahlt (zwei
 * Opus-Aufrufe je Begriff). partitionByExisting faengt das jetzt normalisiert ab
 * (siehe tests/lib/glossary-crawl-existing.test.ts) - dieser Test prueft, dass
 * generateCandidates den abgefangenen Kandidaten auch tatsaechlich ABHAKT
 * (state.generated), statt ihn nur in diesem einen Lauf zu uebergehen. Genau das
 * war die zweite Ursache eines frueheren Abbruchs (s. Kommentar in
 * tests/lib/glossary-crawl-queue.test.ts): ein uebersprungener Kandidat, der bei
 * jedem Lauf erneut in der Warteschlange steht, laesst die Batch-Schleife nie
 * fertig werden.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ generateAndInsertDraft: vi.fn() }))

vi.mock('@/lib/glossary/draft-writer', () => ({
  generateAndInsertDraft: mocks.generateAndInsertDraft,
  lastGenerationFailureWasRetryable: () => false,
}))

interface FakeState {
  settingsValue: unknown
  existingSlugs: string[]
  written: unknown
}

function fakeSupabase(state: FakeState) {
  return {
    from: (table: string) => {
      const chain: any = {}
      chain.select = vi.fn(() => chain)
      chain.eq = vi.fn(() => chain)
      chain.range = vi.fn(() => chain)
      chain.update = vi.fn(() => chain)
      chain.maybeSingle = vi.fn(async () => {
        if (table === 'settings') return { data: { value: state.settingsValue }, error: null }
        return { data: null, error: null }
      })
      chain.upsert = vi.fn(async (payload: { value: unknown }) => {
        state.written = payload.value
        return { error: null }
      })
      // Terminal-Await ohne weiteren Methodenaufruf (die existingSlugs-Abfrage
      // endet auf .range(), nicht auf .maybeSingle()) - await ruft dafuer .then().
      chain.then = (res: (v: unknown) => void) => {
        if (table === 'glossary_terms') {
          return res({ data: state.existingSlugs.map((slug) => ({ slug })), error: null })
        }
        return res({ data: null, error: null })
      }
      return chain
    },
  }
}

beforeEach(() => {
  mocks.generateAndInsertDraft.mockReset()
})

describe('generateCandidates - normalisierte Dubletten', () => {
  it('erzeugt "Eval" nicht, wenn "evals" schon existiert - und hakt es ab', async () => {
    const state: FakeState = {
      settingsValue: { candidates: { Eval: 3 }, generated: [], excluded: [], cursor: null, postsProcessed: 0 },
      existingSlugs: ['evals'],
      written: null,
    }
    const { generateCandidates } = await import('@/lib/glossary/crawl')
    const result = await generateCandidates(fakeSupabase(state) as never, 3)

    expect(mocks.generateAndInsertDraft).not.toHaveBeenCalled()
    expect(result.generated).toEqual([])
    expect(result.alreadyExisting).toEqual(['Eval'])
    // Der Kern des Prod-Bugs vom 2026-08-05: der Kandidat muss im
    // Crawl-State abgehakt sein, sonst steht er beim naechsten Lauf erneut an.
    expect((state.written as { generated: string[] }).generated).toContain('eval')
    expect((state.written as { candidates: Record<string, number> }).candidates).not.toHaveProperty('Eval')
  })

  it('behandelt eine Bindestrich-Variante ("Pre-Training" vs. "pretraining") gleich', async () => {
    const state: FakeState = {
      settingsValue: { candidates: { 'Pre-Training': 1 }, generated: [], excluded: [], cursor: null, postsProcessed: 0 },
      existingSlugs: ['pretraining'],
      written: null,
    }
    const { generateCandidates } = await import('@/lib/glossary/crawl')
    const result = await generateCandidates(fakeSupabase(state) as never, 3)

    expect(mocks.generateAndInsertDraft).not.toHaveBeenCalled()
    expect(result.alreadyExisting).toEqual(['Pre-Training'])
    expect((state.written as { generated: string[] }).generated).toContain('pre-training')
  })

  it('erzeugt einen Kandidaten ohne Kollision weiterhin normal', async () => {
    const state: FakeState = {
      settingsValue: { candidates: { Superintelligenz: 2 }, generated: [], excluded: [], cursor: null, postsProcessed: 0 },
      existingSlugs: ['evals'],
      written: null,
    }
    mocks.generateAndInsertDraft.mockResolvedValue({
      slug: 'superintelligenz', canonicalName: 'Superintelligenz', aliases: [], summary: 's',
    })
    const { generateCandidates } = await import('@/lib/glossary/crawl')
    const result = await generateCandidates(fakeSupabase(state) as never, 3)

    expect(mocks.generateAndInsertDraft).toHaveBeenCalledTimes(1)
    expect(result.generated.map((g) => g.slug)).toEqual(['superintelligenz'])
  })
})
