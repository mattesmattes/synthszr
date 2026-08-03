/**
 * PATCH /api/admin/generated-posts mit confirmedGlossarySlugs (Task 11):
 * Wiring-Test — prüft, dass die Route die Freigabe-Entscheidung erkennt, das
 * Ergebnis in den DB-Update übernimmt und pending_glossary_terms leert.
 *
 * Die eigentliche Injektions-/Freigabe-Logik (hidden-Ausschluss, Content-
 * Fallback, Parse-/Publish-Fehler, reservierte Namen) ist ausführlicher und
 * lesbarer in tests/lib/glossary-confirm.test.ts abgedeckt — hier reicht der
 * Nachweis, dass die Route sie korrekt verdrahtet.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(() => Promise.resolve({ email: 'admin@test' })),
  getMatcherTerms: vi.fn(() => Promise.resolve([
    { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] },
  ])),
  getChartProductNames: vi.fn(() => Promise.resolve([] as string[])),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/glossary/terms', () => ({
  getMatcherTerms: mocks.getMatcherTerms,
  getChartProductNames: mocks.getChartProductNames,
}))

// Tabellen-bewusster PostgREST-Stub: jede Tabelle bekommt ihre eigene FIFO-
// Antwortqueue, jeder Filter bleibt ein vi.fn() für Aufruf-Assertions (Muster
// aus tests/lib/glossary-terms.test.ts / tests/lib/newsletter-access-tokens.test.ts,
// hier um Tabellen-Trennung erweitert, weil diese Route mehrere Tabellen trifft).
const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  chains: [] as any[],
}))

function makeChain(table: string) {
  const chain: any = { table }
  for (const m of ['select', 'eq', 'in', 'update']) {
    chain[m] = vi.fn(() => chain)
  }
  const resolve = () => {
    const q = state.queues[table]
    return q && q.length ? q.shift() : { data: null, error: null }
  }
  chain.single = vi.fn(async () => resolve())
  chain.then = (res: (v: unknown) => void) => res(resolve())
  state.chains.push(chain)
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (table: string) => makeChain(table) }),
}))

function patch(body: unknown) {
  return new Request('http://localhost/api/admin/generated-posts', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function doc(text: string) {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
}

/** Findet die Chain des finalen generated_posts-Updates (nicht den optionalen
 *  Content-Fallback-Fetch, der ebenfalls über from('generated_posts') läuft). */
function finalUpdate() {
  const chain = state.chains.find(
    (c) => c.table === 'generated_posts' && c.update.mock.calls.length > 0,
  )
  return chain.update.mock.calls[0][0] as Record<string, unknown>
}

beforeEach(() => {
  state.queues = {}
  state.chains.length = 0
  mocks.getMatcherTerms.mockClear()
  mocks.getChartProductNames.mockClear()
})

describe('PATCH /api/admin/generated-posts mit Glossar-Slugs', () => {
  it('schreibt eine glossaryLink-Mark in den gespeicherten Content', async () => {
    state.queues = {
      glossary_terms: [
        { error: null }, // publish-Update
        { data: [{ slug: 'inferenz' }], error: null }, // Status-Check
      ],
    }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({
      id: 'p1',
      content: doc('Die Inferenz ist teuer.'),
      confirmedGlossarySlugs: ['inferenz'],
    }) as never)

    const saved = finalUpdate()
    expect(saved.content).toContain('glossaryLink')
    expect(saved.content).toContain('inferenz')
  })

  it('speichert unverändert, wenn keine Slugs übergeben werden', async () => {
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({ id: 'p1', title: 'Neu' }) as never)

    const saved = finalUpdate()
    expect(saved.content ?? '').not.toContain('glossaryLink')
    expect(saved.pending_glossary_terms).toBeUndefined()
    expect(mocks.getMatcherTerms).not.toHaveBeenCalled()
  })

  it('leert pending_glossary_terms nach der Freigabe', async () => {
    state.queues = {
      glossary_terms: [
        { error: null },
        { data: [{ slug: 'inferenz' }], error: null },
      ],
    }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({
      id: 'p1',
      content: doc('Die Inferenz ist teuer.'),
      confirmedGlossarySlugs: ['inferenz'],
    }) as never)

    expect(finalUpdate().pending_glossary_terms).toBeNull()
  })

  it('lässt pending_glossary_terms unangetastet, wenn die Freigabe komplett fehlschlägt', async () => {
    // Review-Fix: schlägt das Publish-Update fehl (z.B. DB kurz nicht
    // erreichbar), bleibt der Begriff draft — die Kandidatenliste darf dann
    // NICHT verschwinden, sonst hat der Admin keinen Weg mehr, die Freigabe
    // erneut anzustoßen, und der Begriff bleibt unauffindbar unveröffentlicht.
    state.queues = {
      glossary_terms: [
        { error: { message: 'db down' } }, // Publish-Update schlägt fehl
        { data: [], error: null }, // Status-Check: nichts wurde published
      ],
    }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({
      id: 'p1',
      content: doc('Die Inferenz ist teuer.'),
      confirmedGlossarySlugs: ['inferenz'],
    }) as never)

    const saved = finalUpdate()
    expect(saved.pending_glossary_terms).toBeUndefined()
    expect(saved.content).not.toContain('glossaryLink')
  })

  it('lädt den Content aus der DB nach, wenn der Body keinen mitschickt (Übersetzungs-/Backfill-Pfad)', async () => {
    state.queues = {
      glossary_terms: [
        { error: null },
        { data: [{ slug: 'inferenz' }], error: null },
      ],
      generated_posts: [
        { data: { content: doc('Die Inferenz ist teuer.') }, error: null }, // Fallback-Fetch
      ],
    }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({ id: 'p1', confirmedGlossarySlugs: ['inferenz'] }) as never)

    expect(finalUpdate().content).toContain('glossaryLink')
  })
})
