/**
 * Nachverlinkung uebersetzter Artikel (content_translations).
 *
 * BEFUND, der das noetig macht (2026-08-06, an Prod gemessen): von 743
 * Uebersetzungszeilen (en/cs/nds/fr) traegt KEINE eine glossaryLink-Mark.
 * Kein Fehler in der Pipeline — reinjectGlossaryMarksForTranslation nimmt die
 * Slugs aus dem QUELLTEXT, und jede bisherige Uebersetzung lief, bevor ihr
 * deutscher Artikel verlinkt war. backfillGlossaryLinks (der relink-Lauf)
 * fasst nur generated_posts an, also holen die Uebersetzungen es nie nach.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMatcherTerms: vi.fn(),
  getChartProductNames: vi.fn(() => Promise.resolve([] as string[])),
}))

vi.mock('@/lib/glossary/terms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/glossary/terms')>()
  return {
    ...actual,
    getMatcherTerms: mocks.getMatcherTerms,
    getChartProductNames: mocks.getChartProductNames,
  }
})

function doc(text: string, mark?: unknown) {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text, ...(mark ? { marks: [mark] } : {}) }],
    }],
  }
}

function linkedSlugs(node: unknown): string[] {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    for (const m of (Array.isArray(o.marks) ? o.marks : [])) {
      const mm = m as { type?: string; attrs?: { slug?: string } }
      if (mm.type === 'glossaryLink' && mm.attrs?.slug) out.push(mm.attrs.slug)
    }
    if (Array.isArray(o.content)) o.content.forEach(walk)
  }
  walk(node)
  return out
}

interface Row { id: string; generated_post_id: string; language_code: string; content: unknown }

/** Fake-Client fuer genau die zwei Tabellen, die der Backfill anfasst. */
function fakeSupabase(opts: {
  translations: Row[]
  posts: Record<string, unknown>
  remaining?: number
  updates: Array<{ id: string; content: unknown }>
  onPostIds?: (ids: unknown[]) => void
}) {
  return {
    from(table: string) {
      if (table === 'content_translations') {
        const chain: Record<string, unknown> = {}
        let isCount = false
        let updatePayload: { content?: unknown } | null = null
        let updateId: string | null = null
        const self: Record<string, unknown> = chain
        for (const m of ['select', 'order', 'limit', 'gt', 'eq', 'not', 'is']) {
          self[m] = vi.fn((...args: unknown[]) => {
            if (m === 'select' && (args[1] as { count?: string })?.count) isCount = true
            if (m === 'eq' && args[0] === 'id') updateId = args[1] as string
            return self
          })
        }
        self.update = vi.fn((payload: { content?: unknown }) => {
          updatePayload = payload
          return self
        })
        ;(self as { then: unknown }).then = (res: (v: unknown) => void) => {
          if (updatePayload) {
            opts.updates.push({ id: updateId!, content: updatePayload.content })
            return res({ data: null, error: null })
          }
          if (isCount) return res({ count: opts.remaining ?? 0, error: null })
          return res({ data: opts.translations, error: null })
        }
        return self
      }
      if (table === 'generated_posts') {
        const self: Record<string, unknown> = {}
        for (const m of ['select', 'in', 'eq']) {
          self[m] = vi.fn((...args: unknown[]) => {
            if (m === 'in' && args[0] === 'id') opts.onPostIds?.(args[1] as unknown[])
            return self
          })
        }
        ;(self as { then: unknown }).then = (res: (v: unknown) => void) =>
          res({
            data: Object.entries(opts.posts).map(([id, content]) => ({ id, content })),
            error: null,
          })
        return self
      }
      throw new Error(`Unerwartete Tabelle: ${table}`)
    },
  }
}

beforeEach(() => {
  mocks.getMatcherTerms.mockReset()
  mocks.getMatcherTerms.mockResolvedValue([
    { slug: 'inferenz', canonicalName: 'Inference', aliases: [] },
  ])
  mocks.getChartProductNames.mockClear()
  mocks.getChartProductNames.mockResolvedValue([])
})

describe('relinkTranslationsBatch', () => {
  it('injiziert die Marks des Quelltexts in die Uebersetzung und schreibt sie zurueck', async () => {
    const { relinkTranslationsBatch } = await import('@/lib/glossary/backfill-translations')
    const updates: Array<{ id: string; content: unknown }> = []
    const supabase = fakeSupabase({
      translations: [
        { id: 't1', generated_post_id: 'p1', language_code: 'en', content: doc('Inference is expensive.') },
      ],
      posts: {
        p1: doc('Die Inferenz ist teuer.', { type: 'glossaryLink', attrs: { slug: 'inferenz' } }),
      },
      updates,
    })

    const result = await relinkTranslationsBatch(supabase as never, null)

    expect(result.linked).toEqual(['t1'])
    expect(updates).toHaveLength(1)
    expect(linkedSlugs(updates[0].content)).toEqual(['inferenz'])
  })

  it('schreibt content als OBJEKT, nicht als JSON-String', async () => {
    // content_translations.content ist jsonb — anders als generated_posts.content,
    // das serialisiertes JSON in einer text-Spalte ist. Ein JSON.stringify hier
    // wuerde einen String IN die jsonb-Spalte legen: gueltiges JSON, aber der
    // Renderer bekommt einen String statt eines Dokuments und zeigt nichts an.
    const { relinkTranslationsBatch } = await import('@/lib/glossary/backfill-translations')
    const updates: Array<{ id: string; content: unknown }> = []
    const supabase = fakeSupabase({
      translations: [
        { id: 't1', generated_post_id: 'p1', language_code: 'en', content: doc('Inference is expensive.') },
      ],
      posts: {
        p1: doc('Die Inferenz ist teuer.', { type: 'glossaryLink', attrs: { slug: 'inferenz' } }),
      },
      updates,
    })

    await relinkTranslationsBatch(supabase as never, null)

    expect(typeof updates[0].content).toBe('object')
    expect(updates[0].content).not.toBeTypeOf('string')
  })

  it('laedt die Begriffsliste je Sprache nur EINMAL, nicht je Zeile', async () => {
    // Der Lauf geht ueber hunderte Zeilen. Ohne Cache waeren es zwei
    // DB-Abfragen je Zeile fuer Daten, die sich waehrend des Laufs nicht
    // aendern.
    const { relinkTranslationsBatch } = await import('@/lib/glossary/backfill-translations')
    const updates: Array<{ id: string; content: unknown }> = []
    const supabase = fakeSupabase({
      translations: [
        { id: 't1', generated_post_id: 'p1', language_code: 'en', content: doc('Inference here.') },
        { id: 't2', generated_post_id: 'p2', language_code: 'en', content: doc('Inference there.') },
        { id: 't3', generated_post_id: 'p3', language_code: 'en', content: doc('Inference everywhere.') },
      ],
      posts: {
        p1: doc('Inferenz hier.', { type: 'glossaryLink', attrs: { slug: 'inferenz' } }),
        p2: doc('Inferenz dort.', { type: 'glossaryLink', attrs: { slug: 'inferenz' } }),
        p3: doc('Inferenz ueberall.', { type: 'glossaryLink', attrs: { slug: 'inferenz' } }),
      },
      updates,
    })

    await relinkTranslationsBatch(supabase as never, null)

    expect(mocks.getMatcherTerms).toHaveBeenCalledTimes(1)
    expect(mocks.getChartProductNames).toHaveBeenCalledTimes(1)
    expect(updates).toHaveLength(3)
  })

  it('laesst eine Uebersetzung unangetastet, deren Quelltext keine Marks hat', async () => {
    const { relinkTranslationsBatch } = await import('@/lib/glossary/backfill-translations')
    const updates: Array<{ id: string; content: unknown }> = []
    const supabase = fakeSupabase({
      translations: [
        { id: 't1', generated_post_id: 'p1', language_code: 'en', content: doc('No jargon here.') },
      ],
      posts: { p1: doc('Kein Fachbegriff hier.') },
      updates,
    })

    const result = await relinkTranslationsBatch(supabase as never, null)

    expect(result.linked).toEqual([])
    expect(result.unchanged).toBe(1)
    expect(updates).toHaveLength(0)
  })

  it('sprengt den Lauf nicht an Zeilen ohne generated_post_id', async () => {
    // Prod-Befund 2026-08-06: 12 der 743 Zeilen sind static_page-/ui-
    // Uebersetzungen und haben generated_post_id = NULL. Ein null in der
    // .in()-Liste serialisiert PostgREST als Literal "null" — die Abfrage
    // stirbt mit `invalid input syntax for type uuid: "null"` und riss den
    // ganzen Tick mit, obwohl diese Zeilen nur uebersprungen werden sollen.
    const { relinkTranslationsBatch } = await import('@/lib/glossary/backfill-translations')
    const updates: Array<{ id: string; content: unknown }> = []
    const supabase = fakeSupabase({
      translations: [
        { id: 't1', generated_post_id: null as unknown as string, language_code: 'en', content: doc('Orphan.') },
        { id: 't2', generated_post_id: 'p1', language_code: 'en', content: doc('Inference is expensive.') },
      ],
      posts: {
        p1: doc('Die Inferenz ist teuer.', { type: 'glossaryLink', attrs: { slug: 'inferenz' } }),
      },
      updates,
      onPostIds: (ids) => {
        // Der eigentliche Regressionsschutz: kein null/leerer Wert darf in die
        // Abfrage gelangen.
        expect(ids.every((v) => typeof v === 'string' && v.length > 0)).toBe(true)
      },
    })

    const result = await relinkTranslationsBatch(supabase as never, null)

    expect(result.linked).toEqual(['t2'])
    expect(result.unchanged).toBe(1)
  })

  it('gibt den Cursor der letzten Zeile und die Restmenge zurueck', async () => {
    const { relinkTranslationsBatch } = await import('@/lib/glossary/backfill-translations')
    const updates: Array<{ id: string; content: unknown }> = []
    const supabase = fakeSupabase({
      translations: [
        { id: 't1', generated_post_id: 'p1', language_code: 'en', content: doc('a') },
        { id: 't2', generated_post_id: 'p1', language_code: 'cs', content: doc('b') },
      ],
      posts: { p1: doc('Kein Treffer.') },
      remaining: 7,
      updates,
    })

    const result = await relinkTranslationsBatch(supabase as never, null)

    expect(result.cursor).toBe('t2')
    expect(result.remaining).toBe(7)
  })

  it('meldet remaining 0 und Cursor null, wenn nichts mehr kommt', async () => {
    const { relinkTranslationsBatch } = await import('@/lib/glossary/backfill-translations')
    const updates: Array<{ id: string; content: unknown }> = []
    const supabase = fakeSupabase({ translations: [], posts: {}, updates })

    const result = await relinkTranslationsBatch(supabase as never, 'irgendwo')

    expect(result.remaining).toBe(0)
    expect(result.cursor).toBeNull()
    expect(result.linked).toEqual([])
  })
})
