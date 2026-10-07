/**
 * Panel-Urteil als Queue-Event.
 *
 * BEFUND 2026-10-06: recordFeedback schrieb nur ranking_suggestions. Für die
 * Herkunftsregel (lib/curation/origin.ts) zählt aber jedes Operator-Event am
 * Item — ein im Panel „behaltenes" Techmeme-Item wird dadurch zum Hand-Item.
 * Ohne Event bliebe diese Bestätigung unsichtbar.
 *
 * Alle fünf UserAction-Werte sind abgedeckt: accepted/added → panel_accept,
 * rejected → panel_reject, reordered/pending → kein Event.
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

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (table: string) => makeChain(table) }),
}))

/** Alle in queue_item_events eingefügten Zeilen, Scheiben flachgeklopft. */
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
})

describe('recordFeedback → queue_item_events', () => {
  it('schreibt panel_accept mit run_id, wenn der Betreiber ein Item behaelt', async () => {
    const { recordFeedback } = await import('@/lib/news-queue/suggestions')
    state.queues['ranking_suggestions'] = [{ data: [{ id: 's1' }], error: null }]

    await recordFeedback('run-1', 'item-1', 'accepted', 2)

    const events = insertedEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      queue_item_id: 'item-1',
      event: 'panel_accept',
      actor: 'operator',
      run_id: 'run-1',
    })
  })

  it('schreibt panel_accept auch bei added — Zugaben des Betreibers sind ein Ja', async () => {
    const { recordFeedback } = await import('@/lib/news-queue/suggestions')
    // added: nie vorgeschlagen → Update trifft nichts, Insert-Pfad.
    state.queues['ranking_suggestions'] = [
      { data: [], error: null },
      { data: null, error: null },
    ]

    await recordFeedback('run-1', 'item-3', 'added', 1)

    const events = insertedEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ queue_item_id: 'item-3', event: 'panel_accept', actor: 'operator', run_id: 'run-1' })
  })

  it('schreibt panel_reject bei Streichen — auch wenn die Suggestion erst eingefuegt werden muss', async () => {
    const { recordFeedback } = await import('@/lib/news-queue/suggestions')
    // Update trifft keine Zeile (user-added) → Insert-Pfad; das Event kommt trotzdem.
    state.queues['ranking_suggestions'] = [
      { data: [], error: null },
      { data: null, error: null },
    ]

    await recordFeedback('run-1', 'item-2', 'rejected', null)

    const events = insertedEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ queue_item_id: 'item-2', event: 'panel_reject', actor: 'operator', run_id: 'run-1' })
  })

  it('schreibt KEIN Event bei reordered — Umsortieren ist kein Urteil ueber das Item', async () => {
    const { recordFeedback } = await import('@/lib/news-queue/suggestions')
    state.queues['ranking_suggestions'] = [{ data: [{ id: 's1' }], error: null }]

    await recordFeedback('run-1', 'item-1', 'reordered', 4)

    expect(insertedEvents()).toHaveLength(0)
  })

  it('schreibt KEIN Event bei pending — noch kein Urteil', async () => {
    const { recordFeedback } = await import('@/lib/news-queue/suggestions')
    state.queues['ranking_suggestions'] = [{ data: [{ id: 's1' }], error: null }]

    await recordFeedback('run-1', 'item-1', 'pending', null)

    expect(insertedEvents()).toHaveLength(0)
  })

  it('wirft weiterhin, wenn ranking_suggestions nicht schreibbar ist', async () => {
    const { recordFeedback } = await import('@/lib/news-queue/suggestions')
    state.queues['ranking_suggestions'] = [{ data: null, error: { message: 'kaputt' } }]

    await expect(recordFeedback('run-1', 'item-1', 'accepted', 1)).rejects.toThrow('recordFeedback update failed: kaputt')
    expect(insertedEvents()).toHaveLength(0)
  })

  it('wirft weiterhin, wenn der Insert scheitert — und schreibt dann kein Event', async () => {
    const { recordFeedback } = await import('@/lib/news-queue/suggestions')
    // Update trifft keine Zeile → Insert-Pfad; der Insert scheitert. Der Umbau
    // in Step 3 dreht den Kontrollfluss (kein early return mehr) — dieser Test
    // sichert, dass das Werfen vor dem Event bleibt.
    state.queues['ranking_suggestions'] = [
      { data: [], error: null },
      { data: null, error: { message: 'kaputt' } },
    ]

    await expect(recordFeedback('run-1', 'item-3', 'added', 1)).rejects.toThrow('recordFeedback insert failed: kaputt')
    expect(insertedEvents()).toHaveLength(0)
  })
})
