/**
 * Ereignisprotokoll der News-Queue (Curation Phase 0, Task 3).
 *
 * Testmuster wie glossary-jobs-service.test.ts: pro Tabelle eine FIFO-Queue,
 * jede Chain-Methode bleibt ein vi.fn(), damit Scheibenzahl und Payloads
 * pruefbar sind. Kein vi.mock: der Client wird als Parameter uebergeben.
 */
import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'

const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  fallback: { data: null as unknown, error: null as unknown },
  chains: {} as Record<string, any[]>,
}))

function makeChain(table: string) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'in', 'is', 'or', 'lt', 'gte', 'order', 'limit', 'range', 'update', 'insert']) {
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

const client = { from: vi.fn((t: string) => makeChain(t)) } as any

// Muster tests/lib/glossary-detail.test.ts:250 — Spy ohne Typannotation,
// damit der Typecheck (tsconfig schliesst tests/ ein) keine Overload-Hürde hat.
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
  state.queues = {}
  state.chains = {}
  state.fallback = { data: null, error: null }
  client.from.mockClear()
  errorSpy.mockClear()
})

afterAll(() => {
  errorSpy.mockRestore()
})

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`)

describe('recordQueueEvents', () => {
  it('macht bei leerer Liste keinen Aufruf', async () => {
    const { recordQueueEvents } = await import('@/lib/news-queue/events')

    await recordQueueEvents(client, [])

    expect(client.from).not.toHaveBeenCalled()
  })

  it('schreibt 450 Events in drei Scheiben (200/200/50)', async () => {
    const { recordQueueEvents } = await import('@/lib/news-queue/events')
    const events = ids(450).map((id) => ({
      queue_item_id: id, event: 'select' as const, actor: 'operator' as const,
      from_status: 'pending', to_status: 'selected',
    }))

    await recordQueueEvents(client, events)

    expect(client.from).toHaveBeenCalledTimes(3)
    expect(client.from).toHaveBeenCalledWith('queue_item_events')
    const chains = state.chains['queue_item_events']
    expect(chains.map((c) => c.insert.mock.calls[0][0].length)).toEqual([200, 200, 50])
    expect(chains[0].insert.mock.calls[0][0][0]).toEqual(events[0])
    expect(chains[2].insert.mock.calls[0][0][49]).toEqual(events[449])
  })

  it('loggt einen PostgREST-Fehler mit Prefix [QueueEvents] und wirft nicht', async () => {
    const { recordQueueEvents } = await import('@/lib/news-queue/events')
    state.queues['queue_item_events'] = [{ data: null, error: { message: 'boom' } }]

    await expect(
      recordQueueEvents(client, [{ queue_item_id: 'a', event: 'use', actor: 'pipeline', to_status: 'used' }]),
    ).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toContain('[QueueEvents]')
    expect(errorSpy.mock.calls[0][1]).toBe('boom')
  })

  it('faengt auch geworfene Fehler (z. B. Netzwerk) ab', async () => {
    const { recordQueueEvents } = await import('@/lib/news-queue/events')
    const broken = { from: vi.fn(() => { throw new Error('network down') }) } as any

    await expect(
      recordQueueEvents(broken, [{ queue_item_id: 'a', event: 'skip', actor: 'operator', reason: 'junk' }]),
    ).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toContain('[QueueEvents]')
    expect(errorSpy.mock.calls[0][1]).toBe('network down')
  })
})

describe('readStatusSnapshot', () => {
  it('macht bei leerer Liste keinen Aufruf und liefert eine leere Map', async () => {
    const { readStatusSnapshot } = await import('@/lib/news-queue/events')

    const snap = await readStatusSnapshot(client, [])

    expect(snap.size).toBe(0)
    expect(client.from).not.toHaveBeenCalled()
  })

  it('liest 450 IDs in drei Scheiben und fasst alle Zeilen zusammen', async () => {
    const { readStatusSnapshot } = await import('@/lib/news-queue/events')
    const all = ids(450)
    const row = (id: string) => ({ id, status: 'pending', bundle_type: null })
    state.queues['news_queue'] = [
      { data: all.slice(0, 200).map(row), error: null },
      { data: all.slice(200, 400).map(row), error: null },
      { data: [{ id: 'id-449', status: 'selected', bundle_type: 'topic' }], error: null },
    ]

    const snap = await readStatusSnapshot(client, all)

    expect(client.from).toHaveBeenCalledTimes(3)
    expect(client.from).toHaveBeenCalledWith('news_queue')
    const chains = state.chains['news_queue']
    expect(chains.map((c) => c.in.mock.calls[0][1].length)).toEqual([200, 200, 50])
    expect(chains[0].in.mock.calls[0][0]).toBe('id')
    expect(chains[0].select.mock.calls[0][0]).toBe('id, status, bundle_type')
    expect(snap.size).toBe(401)
    expect(snap.get('id-0')).toEqual({ status: 'pending', bundle_type: null })
    expect(snap.get('id-449')).toEqual({ status: 'selected', bundle_type: 'topic' })
  })

  it('loggt einen Scheiben-Fehler, wirft nicht und liefert die uebrigen Scheiben', async () => {
    const { readStatusSnapshot } = await import('@/lib/news-queue/events')
    const all = ids(450)
    state.queues['news_queue'] = [
      { data: [{ id: 'id-0', status: 'used', bundle_type: null }], error: null },
      { data: null, error: { message: 'boom' } },
      { data: [{ id: 'id-400', status: 'pending' }], error: null },
    ]

    const snap = await readStatusSnapshot(client, all)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toContain('[QueueEvents]')
    expect(errorSpy.mock.calls[0][1]).toBe('boom')
    expect(snap.size).toBe(2)
    expect(snap.get('id-0')).toEqual({ status: 'used', bundle_type: null })
    expect(snap.get('id-400')).toEqual({ status: 'pending', bundle_type: null })
  })

  it('faengt auch geworfene Fehler (z. B. Netzwerk) ab und liefert eine leere Map', async () => {
    const { readStatusSnapshot } = await import('@/lib/news-queue/events')
    const broken = { from: vi.fn(() => { throw new Error('network down') }) } as any

    const snap = await readStatusSnapshot(broken, ['a'])

    expect(snap).toBeInstanceOf(Map)
    expect(snap.size).toBe(0)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toContain('[QueueEvents]')
    expect(errorSpy.mock.calls[0][1]).toBe('network down')
  })
})

describe('loadEventsForItems', () => {
  const ev = (id: number, queue_item_id: string, at: string) => ({
    id, queue_item_id, at, event: 'select', actor: 'operator',
    from_status: 'pending', to_status: 'selected', from_role: null, to_role: null, reason: null, run_id: null,
  })

  it('macht bei leerer Liste keinen Aufruf und liefert eine leere Map', async () => {
    const { loadEventsForItems } = await import('@/lib/news-queue/events')

    const result = await loadEventsForItems(client, [])

    expect(result.size).toBe(0)
    expect(client.from).not.toHaveBeenCalled()
  })

  it('sortiert Events je Item aufsteigend nach at, dann id; Items ohne Events bekommen []', async () => {
    const { loadEventsForItems } = await import('@/lib/news-queue/events')
    state.queues['queue_item_events'] = [{
      data: [
        ev(3, 'a', '2026-10-06T10:00:00+00:00'),
        ev(9, 'c', '2026-10-01T00:00:00+00:00'),
        ev(7, 'a', '2026-10-05T10:00:00.5+00:00'),
        ev(1, 'a', '2026-10-06T10:00:00+00:00'),
      ],
      error: null,
    }]

    const result = await loadEventsForItems(client, ['a', 'b', 'c'])

    expect(client.from).toHaveBeenCalledTimes(1)
    expect(client.from).toHaveBeenCalledWith('queue_item_events')
    const chain = state.chains['queue_item_events'][0]
    expect(chain.select.mock.calls[0][0]).toBe('*')
    expect(chain.in.mock.calls[0]).toEqual(['queue_item_id', ['a', 'b', 'c']])
    expect(result.size).toBe(3)
    expect(result.get('a')!.map((e) => e.id)).toEqual([7, 1, 3])
    expect(result.get('b')).toEqual([])
    expect(result.get('c')!.map((e) => e.id)).toEqual([9])
  })

  it('liest 450 IDs in drei Scheiben', async () => {
    const { loadEventsForItems } = await import('@/lib/news-queue/events')
    const all = ids(450)
    state.queues['queue_item_events'] = [
      { data: [ev(1, 'id-0', '2026-10-06T10:00:00+00:00')], error: null },
      { data: [], error: null },
      { data: [ev(2, 'id-449', '2026-10-06T11:00:00+00:00')], error: null },
    ]

    const result = await loadEventsForItems(client, all)

    expect(client.from).toHaveBeenCalledTimes(3)
    const chains = state.chains['queue_item_events']
    expect(chains.map((c) => c.in.mock.calls[0][1].length)).toEqual([200, 200, 50])
    expect(result.size).toBe(450)
    expect(result.get('id-0')!.map((e) => e.id)).toEqual([1])
    expect(result.get('id-449')!.map((e) => e.id)).toEqual([2])
    expect(result.get('id-200')).toEqual([])
  })

  it('dedupt die ID-Liste: dieselbe ID in zwei Scheiben liefert jedes Event nur einmal', async () => {
    const { loadEventsForItems } = await import('@/lib/news-queue/events')
    // 'a' an Position 0 und 201 -> ohne Dedupe stuende sie in Scheibe 1 UND 2,
    // und die DB lieferte ihre Zeile zweimal. Mit Dedupe fragt Scheibe 2 nur
    // noch 'id-199' ab; der Mock antwortet darauf realistisch mit [].
    const all = ['a', ...ids(200), 'a']
    state.queues['queue_item_events'] = [
      { data: [ev(1, 'a', '2026-10-06T10:00:00+00:00')], error: null },
      { data: [], error: null },
    ]

    const result = await loadEventsForItems(client, all)

    expect(client.from).toHaveBeenCalledTimes(2)
    const chains = state.chains['queue_item_events']
    expect(chains.map((c) => c.in.mock.calls[0][1].length)).toEqual([200, 1])
    expect(chains[1].in.mock.calls[0][1]).toEqual(['id-199'])
    expect(result.size).toBe(201)
    expect(result.get('a')!.map((e) => e.id)).toEqual([1])
  })

  it('wirft bei DB-Fehler mit Tabellenname (Script-Pfad, kein stilles Leerergebnis)', async () => {
    const { loadEventsForItems } = await import('@/lib/news-queue/events')
    state.queues['queue_item_events'] = [{ data: null, error: { message: 'boom' } }]

    await expect(loadEventsForItems(client, ['a'])).rejects.toThrow('queue_item_events: boom')
  })
})
