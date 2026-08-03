/**
 * Freigabe-Orchestrierung beim Speichern (Task 11): bestätigte Draft-Begriffe
 * veröffentlichen und nur die tatsächlich veröffentlichten Slugs als
 * glossaryLink-Mark in den Artikel-Content schreiben.
 *
 * `applyGlossaryConfirmation` bekommt den Supabase-Client als Parameter
 * (Muster aus lib/glossary/detail.ts:97) — deshalb reicht ein handgebauter
 * Fake-Client, ohne das Admin-Modul zu mocken. Nur die Begriffs-/Produkt-
 * Repositories (lib/glossary/terms.ts) werden gemockt.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { KNOWN_COMPANIES } from '@/lib/data/companies'

const mocks = vi.hoisted(() => ({
  getMatcherTerms: vi.fn(),
  getChartProductNames: vi.fn(() => Promise.resolve([] as string[])),
}))

// buildReservedNames bleibt die ECHTE Implementierung (importOriginal) — sie
// ist pur (keine DB-Anfrage) und wird seit Fix-Runde 1 (Task 16) mit
// reinjectGlossaryMarksForTranslation geteilt, statt in confirm.ts dupliziert
// zu sein. Nur die beiden DB-Repositories werden gemockt.
vi.mock('@/lib/glossary/terms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/glossary/terms')>()
  return {
    ...actual,
    getMatcherTerms: mocks.getMatcherTerms,
    getChartProductNames: mocks.getChartProductNames,
  }
})

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

/** Sammelt alle Textknoten mit glossaryLink-Mark, flach — Muster aus
 *  tests/lib/glossary-inject-marks.test.ts. */
function linked(json: string): Array<{ text: string; slug: string }> {
  const out: Array<{ text: string; slug: string }> = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    const marks = Array.isArray(o.marks) ? o.marks : []
    const mark = marks.find((m) => (m as { type?: string }).type === 'glossaryLink')
    if (typeof o.text === 'string' && mark) {
      out.push({ text: o.text, slug: (mark as { attrs: { slug: string } }).attrs.slug })
    }
    if (Array.isArray(o.content)) o.content.forEach(walk)
  }
  walk(JSON.parse(json))
  return out
}

/** Minimaler PostgREST-Stub für genau eine Tabelle. `queue` liefert die
 *  Antworten in Aufrufreihenfolge (FIFO) — leer heißt "keine weitere Query
 *  erwartet", ein Aufruf danach wirft, statt still `undefined` zu liefern.
 *  `chains` sammelt jede erzeugte Chain (mit Tabellenname), damit Tests nicht
 *  nur den Rückgabewert, sondern auch die tatsächlich genutzten Filter-
 *  Argumente prüfen können (z.B. .in('slug', [...])). */
function fakeSupabase(queues: Record<string, unknown[]>, chains: any[] = []) {
  return {
    from: (table: string) => {
      const chain: any = { table }
      for (const m of ['select', 'eq', 'in', 'update']) {
        chain[m] = vi.fn(() => chain)
      }
      const resolve = () => {
        const q = queues[table]
        if (!q || q.length === 0) {
          throw new Error(`Keine Antwort für unerwarteten Aufruf von .from('${table}') vorgesehen`)
        }
        return q.shift()
      }
      chain.single = vi.fn(async () => resolve())
      chain.then = (res: (v: unknown) => void) => res(resolve())
      chains.push(chain)
      return chain
    },
  }
}

beforeEach(() => {
  mocks.getMatcherTerms.mockReset()
  mocks.getMatcherTerms.mockResolvedValue([
    { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] },
    { slug: 'versteckt', canonicalName: 'Halluzination', aliases: [] },
  ])
  mocks.getChartProductNames.mockClear()
  mocks.getChartProductNames.mockResolvedValue([])
})

describe('applyGlossaryConfirmation', () => {
  it('gibt publishedSlugs: [] zurück und rührt die DB nicht an, wenn keine Slugs bestätigt wurden', async () => {
    const { applyGlossaryConfirmation } = await import('@/lib/glossary/confirm')
    const supabase = fakeSupabase({})
    const result = await applyGlossaryConfirmation(supabase as never, 'p1', [], undefined)
    expect(result).toEqual({ publishedSlugs: [] })
  })

  it('veröffentlicht den Draft und injiziert die Mark für den bestätigten Slug', async () => {
    const { applyGlossaryConfirmation } = await import('@/lib/glossary/confirm')
    const supabase = fakeSupabase({
      glossary_terms: [
        { error: null }, // publish-Update
        { data: [{ slug: 'inferenz' }], error: null }, // Status-Check
      ],
    })
    const result = await applyGlossaryConfirmation(
      supabase as never, 'p1', ['inferenz'], JSON.stringify(doc('Die Inferenz ist teuer.')),
    )
    expect(result.content).toBeDefined()
    expect(linked(result.content!)).toEqual([{ text: 'Inferenz', slug: 'inferenz' }])
    expect(result.publishedSlugs).toEqual(['inferenz'])
  })

  it('ruft getMatcherTerms erst NACH dem Freigabe-Versuch auf, nicht davor', async () => {
    // getMatcherTerms filtert intern auf status=published. Ein frisch
    // bestätigter Draft-Begriff ist zum Zeitpunkt des Publish-Updates noch
    // nicht published — würde getMatcherTerms VORHER laufen, fehlte er in der
    // Trefferliste, und der Regelfall (Draft zum ersten Mal bestätigen) würde
    // still brechen (das war der Fehler im ursprünglichen Plan-Pseudocode).
    // mockResolvedValue liefert unabhängig vom Aufrufzeitpunkt immer dieselbe
    // Liste — ein Assertion auf den Rückgabewert allein kann eine Regression
    // hier nicht erkennen, deshalb der Vergleich über invocationCallOrder.
    const { applyGlossaryConfirmation } = await import('@/lib/glossary/confirm')
    const chains: any[] = []
    const supabase = fakeSupabase({
      glossary_terms: [
        { error: null },
        { data: [{ slug: 'inferenz' }], error: null },
      ],
    }, chains)
    await applyGlossaryConfirmation(
      supabase as never, 'p1', ['inferenz'], JSON.stringify(doc('Die Inferenz ist teuer.')),
    )
    const publishOrder = chains[0].update.mock.invocationCallOrder[0]
    const statusCheckOrder = chains[1].select.mock.invocationCallOrder[0]
    const matcherOrder = mocks.getMatcherTerms.mock.invocationCallOrder[0]
    expect(publishOrder).toBeLessThan(matcherOrder)
    expect(statusCheckOrder).toBeLessThan(matcherOrder)
  })

  it('verlinkt einen bestätigten, aber weiterhin hidden-gesetzten Begriff nicht', async () => {
    // Task 10: ein Kandidat in pending_glossary_terms kann auf einen bereits
    // hidden-gesetzten Begriff zeigen (GlossaryCandidate trägt keinen Status).
    // Der Status-Check liefert daher nur 'inferenz' zurück, obwohl beide
    // Slugs bestätigt wurden — 'versteckt' muss trotzdem ungelinkt bleiben.
    const { applyGlossaryConfirmation } = await import('@/lib/glossary/confirm')
    const chains: any[] = []
    const supabase = fakeSupabase({
      glossary_terms: [
        { error: null },
        { data: [{ slug: 'inferenz' }], error: null },
      ],
    }, chains)
    const result = await applyGlossaryConfirmation(
      supabase as never,
      'p1',
      ['inferenz', 'versteckt'],
      JSON.stringify(doc('Die Inferenz nutzt Halluzination.')),
    )
    const slugs = linked(result.content!).map((l) => l.slug)
    expect(slugs).toContain('inferenz')
    expect(slugs).not.toContain('versteckt')
    // Nicht nur das Ergebnis, auch die Query selbst prüfen: der Status-Check
    // muss BEIDE bestätigten Slugs abfragen, nicht nur den bekanntlich
    // veröffentlichten — sonst wäre der Ausschluss von 'versteckt' Zufall.
    const statusCheckChain = chains[1]
    expect(statusCheckChain.in).toHaveBeenCalledWith('slug', ['inferenz', 'versteckt'])
    expect(statusCheckChain.eq).toHaveBeenCalledWith('status', 'published')
  })

  it('lädt den Content aus der DB nach, wenn keiner übergeben wurde', async () => {
    const { applyGlossaryConfirmation } = await import('@/lib/glossary/confirm')
    const supabase = fakeSupabase({
      glossary_terms: [
        { error: null },
        { data: [{ slug: 'inferenz' }], error: null },
      ],
      generated_posts: [
        { data: { content: JSON.stringify(doc('Die Inferenz ist teuer.')) }, error: null },
      ],
    })
    const result = await applyGlossaryConfirmation(supabase as never, 'p1', ['inferenz'], undefined)
    expect(linked(result.content!)).toEqual([{ text: 'Inferenz', slug: 'inferenz' }])
  })

  it('lädt nicht aus der DB nach, wenn Content bereits übergeben wurde', async () => {
    // fakeSupabase({}) hat keine Antwort für 'generated_posts' vorgesehen —
    // ein Fallback-Fetch würde also werfen. Kein Wurf beweist, dass der
    // übergebene Content Vorrang hat.
    const { applyGlossaryConfirmation } = await import('@/lib/glossary/confirm')
    const supabase = fakeSupabase({
      glossary_terms: [
        { error: null },
        { data: [{ slug: 'inferenz' }], error: null },
      ],
    })
    await expect(applyGlossaryConfirmation(
      supabase as never, 'p1', ['inferenz'], JSON.stringify(doc('Die Inferenz ist teuer.')),
    )).resolves.toBeDefined()
  })

  it('gibt kein content zurück, wenn der Content nicht parsebar ist, statt zu werfen', async () => {
    const { applyGlossaryConfirmation } = await import('@/lib/glossary/confirm')
    const supabase = fakeSupabase({
      glossary_terms: [
        { error: null },
        { data: [{ slug: 'inferenz' }], error: null },
      ],
    })
    const result = await applyGlossaryConfirmation(supabase as never, 'p1', ['inferenz'], 'kein-json{')
    // Der Begriff selbst wurde trotzdem published (davon hängt die
    // pending_glossary_terms-Freigabe beim Aufrufer ab) — nur die Mark im
    // Artikeltext konnte nicht gesetzt werden.
    expect(result).toEqual({ publishedSlugs: ['inferenz'] })
  })

  it('gibt publishedSlugs: [] zurück, wenn kein Slug tatsächlich published ist (fehlgeschlagene Freigabe)', async () => {
    const { applyGlossaryConfirmation } = await import('@/lib/glossary/confirm')
    const supabase = fakeSupabase({
      glossary_terms: [
        { error: { message: 'db down' } }, // Freigabe schlägt fehl
        { data: [], error: null }, // Status-Check: nichts wurde published
      ],
    })
    const result = await applyGlossaryConfirmation(
      supabase as never, 'p1', ['inferenz'], JSON.stringify(doc('Die Inferenz ist teuer.')),
    )
    // publishedSlugs: [] ist das Signal an den Aufrufer, pending_glossary_terms
    // NICHT zu leeren — sonst verschwindet die Kandidatenliste, obwohl nichts
    // tatsächlich veröffentlicht wurde (Review-Fix, Task 11).
    expect(result).toEqual({ publishedSlugs: [] })
  })

  it('reserviert Chart-Produktnamen aus getChartProductNames gegen Kollision', async () => {
    mocks.getMatcherTerms.mockResolvedValue([
      { slug: 'produktname', canonicalName: 'ChartProdX', aliases: [] },
    ])
    mocks.getChartProductNames.mockResolvedValue(['ChartProdX'])
    const { applyGlossaryConfirmation } = await import('@/lib/glossary/confirm')
    const supabase = fakeSupabase({
      glossary_terms: [
        { error: null },
        { data: [{ slug: 'produktname' }], error: null },
      ],
    })
    const result = await applyGlossaryConfirmation(
      supabase as never, 'p1', ['produktname'], JSON.stringify(doc('ChartProdX ist beliebt.')),
    )
    expect(linked(result.content!)).toEqual([])
  })

  it('reserviert Company-Namen aus KNOWN_COMPANIES gegen Kollision', async () => {
    const companyName = Object.keys(KNOWN_COMPANIES)[0]
    mocks.getMatcherTerms.mockResolvedValue([
      { slug: 'firmenbegriff', canonicalName: companyName, aliases: [] },
    ])
    const { applyGlossaryConfirmation } = await import('@/lib/glossary/confirm')
    const supabase = fakeSupabase({
      glossary_terms: [
        { error: null },
        { data: [{ slug: 'firmenbegriff' }], error: null },
      ],
    })
    const result = await applyGlossaryConfirmation(
      supabase as never, 'p1', ['firmenbegriff'], JSON.stringify(doc(`${companyName} ist bekannt.`)),
    )
    expect(linked(result.content!)).toEqual([])
  })
})
