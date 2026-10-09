/**
 * Label-Toggle hinterlaesst ein relabel-Event mit from_role/to_role.
 *
 * Spec „Herkunft und Hand-Begriff" (Betreiber-Vorgabe 2026-10-05): Ein
 * Techmeme-Item, dem der Betreiber ein Label gibt, ist ein Hand-Item. Das
 * relabel-Event ist die Bestaetigung, die isConfirmedByOperator
 * (lib/curation/origin.ts) liest — ohne sie bliebe das Item „unberuehrtes
 * Techmeme" und duerfte nach 24 h zurueckgesetzt werden.
 *
 * FIFO je Tabelle: Eintrag 1 = Snapshot (readStatusSnapshot, VOR dem Update),
 * Eintrag 2 = Update mit .select('id') — das Event kommt nur bei Treffer.
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

function req(body: unknown) {
  return new Request('https://x/api/admin/news-queue/bundle-type', {
    method: 'PATCH',
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
  // Diese Route prueft session?.isAdmin, nicht nur Truthiness.
  mocks.getSession.mockResolvedValue({ isAdmin: true, email: 'admin@x' })
})

describe('PATCH /api/admin/news-queue/bundle-type', () => {
  it('schreibt relabel mit dem Label VOR und NACH dem Toggle', async () => {
    const { PATCH } = await import('@/app/api/admin/news-queue/bundle-type/route')
    state.queues['news_queue'] = [
      { data: [{ id: 'q1', status: 'selected', bundle_type: 'recap' }], error: null }, // Snapshot
      { data: [{ id: 'q1' }], error: null },                                            // Update (.select('id'))
    ]

    const res = await PATCH(req({ id: 'q1', bundle_type: 'topic' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    const events = insertedEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      queue_item_id: 'q1',
      event: 'relabel',
      actor: 'operator',
      from_role: 'recap',
      to_role: 'topic',
    })
  })

  it('to_role null beim Abwaehlen des Labels', async () => {
    const { PATCH } = await import('@/app/api/admin/news-queue/bundle-type/route')
    state.queues['news_queue'] = [
      { data: [{ id: 'q1', status: 'selected', bundle_type: 'topic' }], error: null },
      { data: [{ id: 'q1' }], error: null },
    ]

    const res = await PATCH(req({ id: 'q1', bundle_type: null }))

    expect(res.status).toBe(200)
    expect(insertedEvents()[0]).toMatchObject({ event: 'relabel', from_role: 'topic', to_role: null })
  })

  it('setzt trotz Snapshot-Lesefehler das Label und schreibt das Event mit from_role null', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { PATCH } = await import('@/app/api/admin/news-queue/bundle-type/route')
    state.queues['news_queue'] = [
      { data: null, error: { message: 'kaputt' } }, // Snapshot scheitert (readStatusSnapshot loggt, wirft nie)
      { data: [{ id: 'q1' }], error: null },        // Update laeuft
    ]

    const res = await PATCH(req({ id: 'q1', bundle_type: 'topic' }))

    expect(res.status).toBe(200)
    expect(insertedEvents()[0]).toMatchObject({ event: 'relabel', from_role: null, to_role: 'topic' })
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('[QueueEvents]'))).toBe(true)
    errorSpy.mockRestore()
  })

  it('schreibt kein Event fuer eine unbekannte id — Response bleibt { ok: true } wie bisher', async () => {
    const { PATCH } = await import('@/app/api/admin/news-queue/bundle-type/route')
    state.queues['news_queue'] = [
      { data: [], error: null }, // Snapshot: nichts gefunden
      { data: [], error: null }, // Update: keine Zeile getroffen
    ]

    const res = await PATCH(req({ id: 'gibt-es-nicht', bundle_type: 'topic' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(insertedEvents()).toHaveLength(0)
  })

  it('schreibt kein Event, wenn das Update scheitert', async () => {
    const { PATCH } = await import('@/app/api/admin/news-queue/bundle-type/route')
    state.queues['news_queue'] = [
      { data: [{ id: 'q1', status: 'selected', bundle_type: null }], error: null },
      { data: null, error: { message: 'kaputt' } },
    ]

    const res = await PATCH(req({ id: 'q1', bundle_type: 'topic' }))

    expect(res.status).toBe(500)
    expect(insertedEvents()).toHaveLength(0)
  })

  it('lehnt ein unbekanntes Label mit 400 ab, ohne die Queue anzufassen', async () => {
    const { PATCH } = await import('@/app/api/admin/news-queue/bundle-type/route')

    const res = await PATCH(req({ id: 'q1', bundle_type: 'story' }))

    expect(res.status).toBe(400)
    expect(state.chains['news_queue']).toBeUndefined()
  })
})
