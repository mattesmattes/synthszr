/**
 * generated_posts.published_at beim Übergang auf 'published' (Curation Phase 0).
 *
 * Betreiber-Vorgabe 2026-10-05 (Spec Morgenkonferenz, „Zeitbasis"): der
 * Zeitpunkt des Statuswechsels auf 'published' ist die Zeitbasis für
 * published_units und das as-of der Baseline-Messung. Bisher gab es die Spalte
 * nicht (lib/glossary/crawl.ts:278), created_at ist bei Ghostwriter-Posts der
 * GEWÄHLTE Veröffentlichungstag 07:00 MEZ und updated_at wird nur vom
 * Editor-PATCH gesetzt — keiner der beiden taugt als Publish-Zeitpunkt.
 *
 * BEFUND 2026-10-06: zwei Routen reichen status durch (PATCH = Editor-
 * Speichern, PUT = Status-Knopf in den Listen); nur PUT kannte den Vorzustand
 * (wasPublished). Deshalb hier beide Routen, je vier Fälle: erster Übergang,
 * erneutes Speichern eines schon veröffentlichten Artikels, anderer Status,
 * gescheiterter Vorzustand-Read (fail-closed: kein Zeitstempel).
 *
 * Mock-Muster wie tests/api/glossary-inject-on-save.test.ts: tabellenbewusster
 * PostgREST-Stub mit FIFO-Antwortqueue je Tabelle; jede Chain wird gesammelt,
 * damit das update()-Payload geprüft werden kann.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  revalidatePostPaths: vi.fn(async () => {}),
  queueTranslations: vi.fn(async () => ({ queued: 0, languages: [] as string[] })),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/comments/service', () => ({ revalidatePostPaths: mocks.revalidatePostPaths }))
// PUT stößt beim ersten Publish die Übersetzungs-Queue an (route.ts, Block
// „Queue translations") — ohne Mock liefe das gegen createAdminClient aus
// einem anderen Modul-Scope und würde die FIFO-Queues hier durcheinanderbringen.
vi.mock('@/lib/translations/queue', () => ({ queueTranslations: mocks.queueTranslations }))

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
  chain.maybeSingle = vi.fn(async () => resolve())
  chain.then = (res: (v: unknown) => void) => res(resolve())
  state.chains.push(chain)
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (table: string) => makeChain(table) }),
}))

const req = (method: string, body: unknown) =>
  new Request('http://localhost/api/admin/generated-posts', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as any

/** Payload des generated_posts-Updates (die Vorzustand-Reads laufen über
 *  eigene Chains ohne update()-Aufruf). */
function savedPayload(): Record<string, unknown> {
  const chain = state.chains.find(
    (c) => c.table === 'generated_posts' && c.update.mock.calls.length > 0,
  )
  return chain.update.mock.calls[0][0] as Record<string, unknown>
}

/** Zahl der Lese-Chains auf generated_posts (select() aufgerufen, kein update()). */
function readChains(): number {
  return state.chains.filter(
    (c) => c.table === 'generated_posts' && c.select.mock.calls.length > 0 && c.update.mock.calls.length === 0,
  ).length
}

const NOW = '2026-10-06T08:00:00.000Z'
const READ_ERROR = { data: null, error: { message: 'boom' } }

beforeEach(() => {
  state.queues = {}
  state.chains.length = 0
  mocks.getSession.mockReset()
  mocks.getSession.mockResolvedValue({ email: 'admin@test' })
  mocks.revalidatePostPaths.mockClear()
  mocks.queueTranslations.mockClear()
  // Nur Date faken — Promise-Microtasks bleiben echt, die Route nutzt keine Timer.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PATCH /api/admin/generated-posts: published_at', () => {
  it('setzt published_at auf jetzt, wenn ein Entwurf veröffentlicht wird', async () => {
    state.queues = { generated_posts: [{ data: { status: 'draft' }, error: null }] }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    const res = await PATCH(req('PATCH', { id: 'p1', status: 'published', title: 'Neu' }))

    expect(res.status).toBe(200)
    const saved = savedPayload()
    expect(saved.status).toBe('published')
    expect(saved.published_at).toBe(NOW)
  })

  it('lässt published_at unberührt, wenn ein schon veröffentlichter Artikel erneut gespeichert wird', async () => {
    // Der häufige Fall: Korrektur im Editor nach dem Publish. Ein neuer
    // Zeitstempel würde das as-of der Baseline nach vorn schieben.
    state.queues = { generated_posts: [{ data: { status: 'published' }, error: null }] }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    const res = await PATCH(req('PATCH', { id: 'p1', status: 'published', title: 'Korrigiert' }))

    expect(res.status).toBe(200)
    const saved = savedPayload()
    expect(saved.status).toBe('published')
    expect(saved).not.toHaveProperty('published_at')
  })

  it('liest den Vorzustand nicht und schreibt kein published_at bei anderem Status', async () => {
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    const res = await PATCH(req('PATCH', { id: 'p1', status: 'draft', title: 'Zurück' }))

    expect(res.status).toBe(200)
    expect(savedPayload()).not.toHaveProperty('published_at')
    // Kein zusätzlicher Round-Trip für Nicht-Publish-Speichervorgänge.
    expect(readChains()).toBe(0)
  })

  it('schreibt kein published_at, wenn der Vorzustand-Read scheitert (fail-closed)', async () => {
    // Bei PostgREST-Fehler ist data null — das sähe ohne error-Prüfung wie
    // „noch nie veröffentlicht" aus und würde einen schon veröffentlichten
    // Artikel neu stempeln. Das Speichern selbst muss trotzdem durchgehen.
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.queues = { generated_posts: [READ_ERROR] }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    const res = await PATCH(req('PATCH', { id: 'p1', status: 'published', title: 'Neu' }))

    expect(res.status).toBe(200)
    const saved = savedPayload()
    expect(saved.status).toBe('published')
    expect(saved).not.toHaveProperty('published_at')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[Curation]'), 'p1', 'boom')
  })

  it('loggt die Client-ID ohne Zeilenumbrüche und nie im Format-String', async () => {
    // CodeQL js/log-injection + js/tainted-format-string, PR #13, 2026-10-09:
    // id kommt aus dem Request-Body. Ein \r\n darin erzeugte eine gefälschte
    // Logzeile, ein %s/%o im ersten console-Argument steuerte die Formatierung.
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.queues = { generated_posts: [READ_ERROR] }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(req('PATCH', { id: 'p1\r\n[Curation] gefälscht %s', status: 'published' }))

    const [format, ...args] = warn.mock.calls[0]
    expect(format).not.toContain('p1')
    expect(args).toEqual(['p1[Curation] gefälscht %s', 'boom'])
  })
})

describe('PUT /api/admin/generated-posts: published_at', () => {
  // FIFO generated_posts in PUT bei status='published':
  //   1. wasPublished-Read  select('status, content').single()
  //   2. Update             update().eq().select().single()
  //   3. Content-Nachlade-Read für pregenerateStockSynthszr (kein content im
  //      Body) → Default { data: null } → kein Pregenerate.
  it('setzt published_at auf jetzt, wenn der Status-Knopf einen Entwurf veröffentlicht', async () => {
    state.queues = {
      generated_posts: [
        { data: { status: 'draft', content: null }, error: null },
        { data: { id: 'p1', status: 'published' }, error: null },
      ],
    }
    const { PUT } = await import('@/app/api/admin/generated-posts/route')
    const res = await PUT(req('PUT', { id: 'p1', status: 'published' }))

    expect(res.status).toBe(200)
    const saved = savedPayload()
    expect(saved.status).toBe('published')
    expect(saved.published_at).toBe(NOW)
    // Bestehende Nebenwirkung des ersten Publish bleibt erhalten.
    expect(mocks.queueTranslations).toHaveBeenCalledWith('generated_post', 'p1', 10)
  })

  it('lässt published_at unberührt, wenn der Artikel schon veröffentlicht war', async () => {
    state.queues = {
      generated_posts: [
        { data: { status: 'published', content: null }, error: null },
        { data: { id: 'p1', status: 'published' }, error: null },
      ],
    }
    const { PUT } = await import('@/app/api/admin/generated-posts/route')
    const res = await PUT(req('PUT', { id: 'p1', status: 'published' }))

    expect(res.status).toBe(200)
    expect(savedPayload()).not.toHaveProperty('published_at')
    expect(mocks.queueTranslations).not.toHaveBeenCalled()
  })

  it('schreibt kein published_at beim Archivieren', async () => {
    state.queues = {
      generated_posts: [{ data: { id: 'p1', status: 'archived' }, error: null }],
    }
    const { PUT } = await import('@/app/api/admin/generated-posts/route')
    const res = await PUT(req('PUT', { id: 'p1', status: 'archived' }))

    expect(res.status).toBe(200)
    const saved = savedPayload()
    expect(saved.status).toBe('archived')
    expect(saved).not.toHaveProperty('published_at')
    expect(readChains()).toBe(0)
  })

  it('schreibt kein published_at, wenn der wasPublished-Read scheitert (fail-closed)', async () => {
    // wasPublished bleibt dabei false wie bisher (Translations werden erneut
    // gequeued — wiederholbar), nur der dauerhafte Zeitstempel unterbleibt.
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.queues = {
      generated_posts: [
        READ_ERROR,
        { data: { id: 'p1', status: 'published' }, error: null },
      ],
    }
    const { PUT } = await import('@/app/api/admin/generated-posts/route')
    const res = await PUT(req('PUT', { id: 'p1', status: 'published' }))

    expect(res.status).toBe(200)
    const saved = savedPayload()
    expect(saved.status).toBe('published')
    expect(saved).not.toHaveProperty('published_at')
    expect(mocks.queueTranslations).toHaveBeenCalledWith('generated_post', 'p1', 10)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[Curation]'), 'p1', 'boom')
  })
})

describe('published_at-Spalte fehlt (Migration noch nicht angewendet)', () => {
  // BEFUND 2026-10-08 (Abschluss-Review A-1/E-1): PostgREST lehnt den ganzen
  // Update ab, wenn published_at im Body steht und die Spalte fehlt — ohne
  // Rückfall scheiterte jede Erstveröffentlichung mit 500. Erwartet: genau
  // ein zweiter Update ohne published_at, Publish geht durch, [Curation]-Log.
  const MISSING_COLUMN = {
    data: null,
    error: { code: 'PGRST204', message: "Could not find the 'published_at' column of 'generated_posts' in the schema cache" },
  }
  const updatePayloads = (): Array<Record<string, unknown>> =>
    state.chains
      .filter((c) => c.table === 'generated_posts' && c.update.mock.calls.length > 0)
      .map((c) => c.update.mock.calls[0][0] as Record<string, unknown>)

  it('PATCH: wiederholt den Update einmal ohne published_at und antwortet 200', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.queues = {
      generated_posts: [{ data: { status: 'draft' }, error: null }, MISSING_COLUMN, { data: null, error: null }],
    }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    const res = await PATCH(req('PATCH', { id: 'p1', status: 'published', title: 'Neu' }))

    expect(res.status).toBe(200)
    const [first, second] = updatePayloads()
    expect(first.published_at).toBe(NOW)
    expect(second).toEqual({ status: 'published', title: 'Neu' })
    expect(updatePayloads()).toHaveLength(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[Curation] published_at-Spalte fehlt'), 'p1', MISSING_COLUMN.error.message)
  })

  it('PUT: wiederholt den Update einmal ohne published_at, Erst-Publish-Nebenwirkungen laufen weiter', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    state.queues = {
      generated_posts: [
        { data: { status: 'draft', content: null }, error: null },
        MISSING_COLUMN,
        { data: { id: 'p1', status: 'published' }, error: null },
      ],
    }
    const { PUT } = await import('@/app/api/admin/generated-posts/route')
    const res = await PUT(req('PUT', { id: 'p1', status: 'published' }))

    expect(res.status).toBe(200)
    const [first, second] = updatePayloads()
    expect(first.published_at).toBe(NOW)
    expect(second).toEqual({ status: 'published' })
    expect(mocks.queueTranslations).toHaveBeenCalledWith('generated_post', 'p1', 10)
  })

  it('anderer Update-Fehler: kein zweiter Versuch, weiter 500', async () => {
    state.queues = {
      generated_posts: [{ data: { status: 'draft' }, error: null }, { data: null, error: { code: '23505', message: 'duplicate key' } }],
    }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    const res = await PATCH(req('PATCH', { id: 'p1', status: 'published', title: 'Neu' }))

    expect(res.status).toBe(500)
    expect(updatePayloads()).toHaveLength(1)
  })
})
