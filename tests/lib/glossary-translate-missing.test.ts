/**
 * Nachziehen fehlender Begriffs-Uebersetzungen.
 *
 * BEFUND 2026-08-06 (Betreiber, an Prod gemessen): 559 veroeffentlichte
 * Begriffe, 428 EN-Uebersetzungen — 134 fehlen, /en/glossary/git-worktree zeigt
 * deutschen Text. Eine Uebersetzung entsteht nur bei der FREIGABE eines
 * Begriffs (applyGlossaryConfirmation -> translatePublishedTerms); ein Begriff,
 * bei dem dieser Aufruf einmal gescheitert ist oder der vor dem Einbau der
 * Uebersetzung entstand, bleibt dauerhaft deutsch.
 *
 * Bis heute Morgen zog ein Fehler in confirm.ts das versehentlich mit: dort
 * wurden ALLE bestaetigten Slugs uebersetzt, nicht nur die frisch
 * veroeffentlichten — teuer (106 Modellaufrufe je Durchlauf, s. Timeout-Haenger),
 * aber es holte fehlende Uebersetzungen nach. Nach dem Fix braucht es diesen
 * bewussten Weg.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ translateTerm: vi.fn() }))

// Nur translateTerm ersetzen, der Rest von translate.ts bleibt echt: die Datei
// exportiert auch reinjectGlossaryMarksForTranslation, das andere Pfade nutzen.
vi.mock('@/lib/glossary/translate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/glossary/translate')>()
  return { ...actual, translateTerm: mocks.translateTerm }
})

interface Row { id: string; slug: string }

function fakeSupabase(opts: {
  published: Row[]
  translatedIds: string[]
  captured?: { selects: string[] }
}) {
  return {
    from(table: string) {
      const self: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit', 'in', 'is']) {
        self[m] = vi.fn(() => self)
      }
      ;(self as { then: unknown }).then = (res: (v: unknown) => void) => {
        if (table === 'glossary_terms') return res({ data: opts.published, error: null })
        if (table === 'glossary_term_translations') {
          return res({ data: opts.translatedIds.map((id) => ({ term_id: id })), error: null })
        }
        return res({ data: [], error: null })
      }
      return self
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.translateTerm.mockResolvedValue(undefined)
})

describe('translateMissingTerms', () => {
  it('uebersetzt genau die Begriffe ohne Uebersetzung, in der Reihenfolge der Slugs', async () => {
    const { translateMissingTerms } = await import('@/lib/glossary/translate-missing')
    const supabase = fakeSupabase({
      published: [{ id: 't1', slug: 'alpha' }, { id: 't2', slug: 'beta' }, { id: 't3', slug: 'gamma' }],
      translatedIds: ['t2'],
    })

    const r = await translateMissingTerms(supabase as never, 5)

    expect(r.done).toEqual(['alpha', 'gamma'])
    expect(r.remaining).toBe(0)
    expect(mocks.translateTerm).toHaveBeenCalledTimes(2)
  })

  it('haelt sich an das Limit und meldet den Rest', async () => {
    // Eine Einheit je Begriff: der Tick soll nach jedem Begriff sein Budget
    // pruefen koennen, statt 134 Modellaufrufe in einem Rutsch zu versuchen.
    const { translateMissingTerms } = await import('@/lib/glossary/translate-missing')
    const supabase = fakeSupabase({
      published: [{ id: 't1', slug: 'a' }, { id: 't2', slug: 'b' }, { id: 't3', slug: 'c' }],
      translatedIds: [],
    })

    const r = await translateMissingTerms(supabase as never, 1)

    expect(r.done).toEqual(['a'])
    expect(r.remaining).toBe(2)
  })

  it('meldet einen Fehlschlag, ohne den Lauf abzubrechen', async () => {
    mocks.translateTerm.mockRejectedValueOnce(new Error('Modell überlastet'))
    const { translateMissingTerms } = await import('@/lib/glossary/translate-missing')
    const supabase = fakeSupabase({
      published: [{ id: 't1', slug: 'kaputt' }, { id: 't2', slug: 'ok' }],
      translatedIds: [],
    })

    const r = await translateMissingTerms(supabase as never, 2)

    expect(r.failed).toEqual(['kaputt'])
    expect(r.done).toEqual(['ok'])
  })

  it('meldet remaining 0 und nichts zu tun, wenn alle uebersetzt sind', async () => {
    const { translateMissingTerms } = await import('@/lib/glossary/translate-missing')
    const supabase = fakeSupabase({
      published: [{ id: 't1', slug: 'a' }],
      translatedIds: ['t1'],
    })

    const r = await translateMissingTerms(supabase as never, 5)

    expect(r.done).toEqual([])
    expect(r.remaining).toBe(0)
    expect(mocks.translateTerm).not.toHaveBeenCalled()
  })
})
