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

/**
 * PostgREST kappt eine Zeilen-Abfrage OHNE `.range()` still bei 1000 Zeilen —
 * genau die Grenze, an der translateMissingTerms Phantom-„Fehlende" erfand
 * (Betreiber-Befund 2026-08-10: 2132 Begriffe, done_count lief endlos hoch,
 * remaining klebte bei ~30). Der alte Mock loeste `.then` sofort mit ALLEN
 * Zeilen auf und bildete diese Grenze nie ab — deshalb rutschte der Bug durch.
 *
 * Dieser Mock bildet sie nach: `.order(col)` sortiert, `.range(from,to)` liefert
 * genau das Fenster, ohne `.range()` gibt es hoechstens PAGE_LIMIT Zeilen.
 */
const PAGE_LIMIT = 1000

function fakeSupabase(opts: {
  published: Row[]
  /** term_ids mit EN-Uebersetzung, in Speicherreihenfolge (unsortiert wie in Prod). */
  translatedIds: string[]
}) {
  return {
    from(table: string) {
      let orderCol: string | null = null
      let rangeFrom: number | null = null
      let rangeTo: number | null = null
      const self: Record<string, unknown> = {}
      self.select = vi.fn(() => self)
      self.eq = vi.fn(() => self)
      self.limit = vi.fn(() => self)
      self.in = vi.fn(() => self)
      self.is = vi.fn(() => self)
      self.order = vi.fn((col: string) => { orderCol = col; return self })
      self.range = vi.fn((from: number, to: number) => { rangeFrom = from; rangeTo = to; return self })
      ;(self as { then: unknown }).then = (res: (v: unknown) => void) => {
        let rows: Array<Record<string, unknown>> =
          table === 'glossary_terms'
            ? opts.published.map((r) => ({ ...r }))
            : table === 'glossary_term_translations'
              ? opts.translatedIds.map((id) => ({ term_id: id }))
              : []
        if (orderCol) {
          rows = [...rows].sort((a, b) =>
            String(a[orderCol!]).localeCompare(String(b[orderCol!])))
        }
        // Mit range(): genau das Fenster. Ohne range(): PostgRESTs stilles
        // Kappen bei PAGE_LIMIT.
        rows = rangeFrom !== null && rangeTo !== null
          ? rows.slice(rangeFrom, rangeTo + 1)
          : rows.slice(0, PAGE_LIMIT)
        return res({ data: rows, error: null })
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

  it('erfindet keine Phantom-Fehlenden ueber der 1000-Zeilen-Grenze', async () => {
    // 1200 Begriffe, ALLE uebersetzt. Die Uebersetzungen liegen in umgekehrter
    // Reihenfolge im Speicher (wie in Prod unsortiert) — ohne Pagination laedt
    // die Funktion nur die ersten 1000 Begriffe (nach slug) und die ersten 1000
    // Uebersetzungen (t1199..t0200), haelt also t0000..t0199 faelschlich fuer
    // fehlend und uebersetzt sie endlos neu. Mit Pagination ist nichts offen.
    const N = 1200
    const published: Row[] = Array.from({ length: N }, (_, i) => ({
      id: `t${String(i).padStart(4, '0')}`,
      slug: `s${String(i).padStart(4, '0')}`,
    }))
    const translatedIds = published.map((r) => r.id).reverse()
    const { translateMissingTerms } = await import('@/lib/glossary/translate-missing')
    const supabase = fakeSupabase({ published, translatedIds })

    const r = await translateMissingTerms(supabase as never, 1)

    expect(r.done).toEqual([])
    expect(r.remaining).toBe(0)
    expect(mocks.translateTerm).not.toHaveBeenCalled()
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
