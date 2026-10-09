/**
 * Nachtraegliches Heben von Techmeme-Quellen auf „Thema des Tages" hinterlaesst
 * ein techmeme_promote-Event.
 *
 * BEFUND 2026-10-06: promoteExistingTopicSources setzte status='selected' und
 * bundle_type='topic' ohne Spur. Fuer die Herkunftsregel ist das der Unterschied
 * zwischen „vom Techmeme-Lauf gewaehlt" (kein Hand-Item, darf verfallen) und
 * „vom Betreiber gewaehlt" (Hand-Item) — ohne Event fiele die Zeile auf den
 * metadata-Fallback zurueck.
 *
 * Die Funktion hebt in Batches von 100; die Batch-Grenze ist mit 101 Zeilen
 * abgedeckt (zwei Update-Chains, zwei Event-Scheiben, Fehler im zweiten Batch
 * laesst die Events des ersten stehen).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

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

// job.ts bekommt den Client als Parameter; service.ts (addToQueue) wird nur
// importiert, nicht aufgerufen — der Stub verhindert den Env-Check in admin.ts.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

const client = { from: vi.fn((t: string) => makeChain(t)) } as any

/** Alle in queue_item_events eingefuegten Zeilen, Scheiben flachgeklopft. */
function insertedEvents(): Array<Record<string, unknown>> {
  return (state.chains['queue_item_events'] ?? []).flatMap((c) =>
    c.insert.mock.calls.flatMap((args: unknown[]) => {
      const arg = args[0]
      return (Array.isArray(arg) ? arg : [arg]) as Array<Record<string, unknown>>
    })
  )
}

/** n pending-Zeilen derselben Story, ids id-0 .. id-(n-1). */
function zeilen(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, metadata: { techmeme_story: 'openai-dots' }, bundle_type: null }))
}

beforeEach(() => {
  state.queues = {}
  state.chains = {}
  state.fallback = { data: null, error: null }
  client.from.mockClear()
})

describe('promoteExistingTopicSources', () => {
  it('hebt nur Quellen der aktiven Themen und schreibt je Quelle ein techmeme_promote-Event', async () => {
    const { promoteExistingTopicSources } = await import('@/lib/techmeme/job')
    state.queues['news_queue'] = [
      // Seite 1 der pending-Quellen (kuerzer als PAGE → letzte Seite)
      {
        data: [
          { id: 'a', metadata: { techmeme_story: 'openai-dots' }, bundle_type: null },
          { id: 'b', metadata: { techmeme_story: 'andere-story' }, bundle_type: null },
          { id: 'c', metadata: {}, bundle_type: 'recap' },
        ],
        error: null,
      },
      // Update-Batch
      { data: null, error: null },
    ]

    const n = await promoteExistingTopicSources(client, new Set(['openai-dots']))

    expect(n).toBe(1)
    const update = state.chains['news_queue'][1]
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ bundle_type: 'topic', status: 'selected' }))
    expect(update.in).toHaveBeenCalledWith('id', ['a'])

    const events = insertedEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      queue_item_id: 'a',
      event: 'techmeme_promote',
      actor: 'techmeme',
      from_status: 'pending',
      to_status: 'selected',
      from_role: null,
      to_role: 'topic',
    })
  })

  it('traegt ein vorhandenes Label als from_role ein', async () => {
    const { promoteExistingTopicSources } = await import('@/lib/techmeme/job')
    state.queues['news_queue'] = [
      { data: [{ id: 'a', metadata: { techmeme_story: 'openai-dots' }, bundle_type: 'recap' }], error: null },
      { data: null, error: null },
    ]

    await promoteExistingTopicSources(client, new Set(['openai-dots']))

    expect(insertedEvents()[0]).toMatchObject({ queue_item_id: 'a', from_role: 'recap', to_role: 'topic' })
  })

  it('hebt 101 Zeilen in zwei Batches und schreibt je Batch eine Event-Scheibe mit den richtigen IDs', async () => {
    const { promoteExistingTopicSources } = await import('@/lib/techmeme/job')
    state.queues['news_queue'] = [
      { data: zeilen(101), error: null }, // eine Seite (101 < PAGE)
      { data: null, error: null },        // Update-Batch 1 (100)
      { data: null, error: null },        // Update-Batch 2 (1)
    ]

    const n = await promoteExistingTopicSources(client, new Set(['openai-dots']))

    expect(n).toBe(101)
    const [, batch1, batch2] = state.chains['news_queue']
    expect(batch1.in.mock.calls[0][1]).toHaveLength(100)
    expect(batch1.in.mock.calls[0][1][0]).toBe('id-0')
    expect(batch2.in).toHaveBeenCalledWith('id', ['id-100'])

    // Zwei recordQueueEvents-Aufrufe → zwei Chains auf queue_item_events
    expect(state.chains['queue_item_events']).toHaveLength(2)
    const events = insertedEvents()
    expect(events).toHaveLength(101)
    expect(events[0]).toMatchObject({ queue_item_id: 'id-0', event: 'techmeme_promote' })
    expect(events[100]).toMatchObject({ queue_item_id: 'id-100', event: 'techmeme_promote' })
  })

  it('laesst bei Fehler im zweiten Batch die Events des ersten stehen und bricht wie bisher ab', async () => {
    const { promoteExistingTopicSources } = await import('@/lib/techmeme/job')
    state.queues['news_queue'] = [
      { data: zeilen(101), error: null },
      { data: null, error: null },
      { data: null, error: { message: 'kaputt' } },
    ]

    await expect(promoteExistingTopicSources(client, new Set(['openai-dots'])))
      .rejects.toThrow('Nachtraegliche Themen-Zuordnung fehlgeschlagen: kaputt')
    expect(insertedEvents()).toHaveLength(100)
  })

  it('schreibt kein Event, wenn das Update scheitert (der Lauf bricht wie bisher ab)', async () => {
    const { promoteExistingTopicSources } = await import('@/lib/techmeme/job')
    state.queues['news_queue'] = [
      { data: [{ id: 'a', metadata: { techmeme_story: 'openai-dots' }, bundle_type: null }], error: null },
      { data: null, error: { message: 'kaputt' } },
    ]

    await expect(promoteExistingTopicSources(client, new Set(['openai-dots'])))
      .rejects.toThrow('Nachtraegliche Themen-Zuordnung fehlgeschlagen: kaputt')
    expect(insertedEvents()).toHaveLength(0)
  })

  it('tut nichts ohne aktive Themen', async () => {
    const { promoteExistingTopicSources } = await import('@/lib/techmeme/job')

    expect(await promoteExistingTopicSources(client, new Set())).toBe(0)
    expect(client.from).not.toHaveBeenCalled()
  })
})
