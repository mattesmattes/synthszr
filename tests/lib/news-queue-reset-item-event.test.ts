/**
 * Final Cut hinterlaesst ein remove-Event.
 *
 * BEFUND 2026-10-06: „Item entfernen" auf der Edit-Seite setzt das Item per
 * reset-item still auf pending — edit_history kennt den Vorgang nicht, die
 * Zeile sieht danach aus wie nie gewaehlt. Dabei ist genau das die staerkste
 * Negativ-Stufe (Spec „Drei Label-Stufen": selected, aber gestrichen).
 *
 * FIFO je Tabelle: Eintrag 1 = Snapshot (readStatusSnapshot, VOR dem Update),
 * Eintrag 2 = Update mit .select('id, status').
 *
 * Liegt unter tests/lib (nicht tests/api), weil die CI nur tests/lib laeuft —
 * reiner Unit-Test mit Mocks, kein Live-Fetch.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))

const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  fallback: { data: null as unknown, error: null as unknown },
  chains: {} as Record<string, any[]>,
}))

function makeChain(table: string) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'in', 'is', 'or', 'lt', 'gte', 'order', 'limit', 'range', 'update', 'insert', 'delete']) {
    chain[m] = vi.fn(() => chain)
  }
  const queue = state.queues[table]
  const own = queue && queue.length ? queue.shift() : undefined
  const resolved = () => own ?? state.fallback
  chain.single = vi.fn(async () => resolved())
  chain.maybeSingle = vi.fn(async () => resolved())
  chain.then = (res: (v: unknown) => void) => res(resolved())
  ;(state.chains[table] ??= []).push(chain)
  return chain
}

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (table: string) => makeChain(table) }),
}))

// Die Route liest nur request.json() — ein Request als NextRequest genuegt.
function req(body: unknown) {
  return new Request('https://x/api/admin/news-queue', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as any
}

/** Alle in queue_item_events eingefuegten Zeilen, Scheiben flachgeklopft. */
function insertedEvents(): Array<Record<string, unknown>> {
  return (state.chains['queue_item_events'] ?? []).flatMap((c) =>
    c.insert.mock.calls.flatMap((args: unknown[]) => {
      const arg = args[0]
      return (Array.isArray(arg) ? arg : [arg]) as Array<Record<string, unknown>>
    })
  )
}

beforeEach(() => {
  state.queues = {}
  state.chains = {}
  state.fallback = { data: null, error: null }
  mocks.getSession.mockReset()
  // POST prueft nur, DASS eine Sitzung existiert (route.ts:300-303).
  mocks.getSession.mockResolvedValue({ isAdmin: true, email: 'admin@x' })
})

describe('POST /api/admin/news-queue — reset-item', () => {
  it('schreibt remove mit from_status aus dem Vorzustand und reason/source der Edit-Seite', async () => {
    const { POST } = await import('@/app/api/admin/news-queue/route')
    state.queues['news_queue'] = [
      { data: [{ id: 'q1', status: 'selected', bundle_type: null }], error: null }, // Snapshot VOR dem Update
      { data: [{ id: 'q1', status: 'pending' }], error: null },                    // Update
    ]

    const res = await POST(req({ action: 'reset-item', itemId: 'q1', reason: 'draft_remove', source: 'draft' }))

    expect(res.status).toBe(200)
    const events = insertedEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      queue_item_id: 'q1',
      event: 'remove',
      actor: 'operator',
      from_status: 'selected',
      to_status: 'pending',
      reason: 'draft_remove',
    })
    // Response-Shape bleibt wie bisher — die Edit-Seite prueft nur response.ok.
    await expect(res.json()).resolves.toMatchObject({ success: true, updated: { id: 'q1', status: 'pending' } })
  })

  it('leitet reason aus source ab, wenn der Aufrufer keinen nennt', async () => {
    const { POST } = await import('@/app/api/admin/news-queue/route')
    state.queues['news_queue'] = [
      { data: [{ id: 'q1', status: 'used', bundle_type: 'topic' }], error: null },
      { data: [{ id: 'q1', status: 'pending' }], error: null },
    ]

    const res = await POST(req({ action: 'reset-item', itemId: 'q1', source: 'queue' }))

    expect(res.status).toBe(200)
    expect(insertedEvents()[0]).toMatchObject({ event: 'remove', from_status: 'used', reason: 'queue_remove' })
  })

  it('nimmt einen genannten reason vor der Ableitung aus source', async () => {
    const { POST } = await import('@/app/api/admin/news-queue/route')
    state.queues['news_queue'] = [
      { data: [{ id: 'q1', status: 'selected', bundle_type: null }], error: null },
      { data: [{ id: 'q1', status: 'pending' }], error: null },
    ]

    // reason und source widersprechen sich absichtlich: Nur so faellt eine
    // vertauschte Reihenfolge (source vor reason → 'draft_remove') auf.
    const res = await POST(req({ action: 'reset-item', itemId: 'q1', reason: 'dublette', source: 'draft' }))

    expect(res.status).toBe(200)
    expect(insertedEvents()[0]).toMatchObject({ event: 'remove', from_status: 'selected', reason: 'dublette' })
  })

  it('schreibt reason null, wenn weder reason noch source mitkommen (alte Aufrufer)', async () => {
    const { POST } = await import('@/app/api/admin/news-queue/route')
    state.queues['news_queue'] = [
      { data: [{ id: 'q1', status: 'selected', bundle_type: null }], error: null },
      { data: [{ id: 'q1', status: 'pending' }], error: null },
    ]

    const res = await POST(req({ action: 'reset-item', itemId: 'q1' }))

    expect(res.status).toBe(200)
    expect(insertedEvents()[0]).toMatchObject({ event: 'remove', from_status: 'selected', reason: null })
  })

  it('ignoriert unbrauchbare reason/source (Zahl, unbekannte Quelle) — Event mit reason null, Reset laeuft', async () => {
    const { POST } = await import('@/app/api/admin/news-queue/route')
    state.queues['news_queue'] = [
      { data: [{ id: 'q1', status: 'selected', bundle_type: null }], error: null },
      { data: [{ id: 'q1', status: 'pending' }], error: null },
    ]

    const res = await POST(req({ action: 'reset-item', itemId: 'q1', reason: 42, source: 'x' }))

    expect(res.status).toBe(200)
    const events = insertedEvents()
    expect(events).toHaveLength(1)
    // Kein 'x_remove', kein 42: Unbrauchbares wird fuer das Event zu null.
    expect(events[0]).toMatchObject({ event: 'remove', from_status: 'selected', to_status: 'pending', reason: null })
  })

  it('setzt trotz Snapshot-Lesefehler zurueck und schreibt das Event mit from_status null', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { POST } = await import('@/app/api/admin/news-queue/route')
    state.queues['news_queue'] = [
      { data: null, error: { message: 'kaputt' } },             // Snapshot scheitert (readStatusSnapshot loggt, wirft nie)
      { data: [{ id: 'q1', status: 'pending' }], error: null }, // Update laeuft
    ]

    const res = await POST(req({ action: 'reset-item', itemId: 'q1', source: 'draft' }))

    expect(res.status).toBe(200)
    expect(insertedEvents()[0]).toMatchObject({ event: 'remove', from_status: null, to_status: 'pending', reason: 'draft_remove' })
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('[QueueEvents]'))).toBe(true)
    errorSpy.mockRestore()
  })

  it('schreibt kein Event, wenn das Update scheitert (500 wie bisher)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { POST } = await import('@/app/api/admin/news-queue/route')
    state.queues['news_queue'] = [
      { data: [{ id: 'q1', status: 'selected', bundle_type: null }], error: null }, // Snapshot
      { data: null, error: { message: 'kaputt' } },                                // Update scheitert
    ]

    const res = await POST(req({ action: 'reset-item', itemId: 'q1', reason: 'draft_remove', source: 'draft' }))

    // Die Zeile bleibt 'selected' — ein remove-Event behauptete das Gegenteil.
    expect(res.status).toBe(500)
    expect(insertedEvents()).toHaveLength(0)
    errorSpy.mockRestore()
  })

  it('schreibt kein Event, wenn kein Item getroffen wurde (404 wie bisher)', async () => {
    const { POST } = await import('@/app/api/admin/news-queue/route')
    state.queues['news_queue'] = [
      { data: [], error: null },
      { data: [], error: null },
    ]

    const res = await POST(req({ action: 'reset-item', itemId: 'fehlt' }))

    expect(res.status).toBe(404)
    expect(insertedEvents()).toHaveLength(0)
  })

  it('weist ohne Sitzung ab, ohne die Queue anzufassen', async () => {
    mocks.getSession.mockResolvedValue(null)
    const { POST } = await import('@/app/api/admin/news-queue/route')

    const res = await POST(req({ action: 'reset-item', itemId: 'q1' }))

    expect(res.status).toBe(401)
    expect(state.chains['news_queue']).toBeUndefined()
  })
})
