/**
 * Scout (Task 6, lib/curation/scout.ts): Kernsatz je Meldung per Haiku,
 * Batches, Card-Cache. makeChain wie tests/lib/curation-service.test.ts
 * (Supabase-Service-Tests), hier nur fuer curation_cards gebraucht.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  batchesOf,
  fallbackCard,
  loadCachedCards,
  parseScoutOutput,
  saveCards,
  scoutBatch,
  SCOUT_TOOL,
} from '@/lib/curation/scout'
import { CallInvalidError, CallRefusedError } from '@/lib/ai/call'
import type { PoolSnapshotItem } from '@/lib/curation/types'

const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  fallback: { data: null as unknown, error: null as unknown },
  chains: {} as Record<string, any[]>,
}))

function makeChain(table: string) {
  const chain: any = {}
  const methods = [
    'select', 'eq', 'neq', 'in', 'is', 'or', 'not', 'lt', 'lte', 'gt', 'gte',
    'order', 'limit', 'range', 'update', 'insert', 'upsert', 'delete',
  ]
  for (const method of methods) chain[method] = vi.fn(() => chain)
  const queue = state.queues[table]
  const own = queue && queue.length ? queue.shift() : undefined
  const resolved = () => own ?? state.fallback
  chain.single = vi.fn(async () => resolved())
  chain.maybeSingle = vi.fn(async () => resolved())
  chain.then = (res: (v: unknown) => void) => res(resolved())
  ;(state.chains[table] ??= []).push(chain)
  return chain
}

const client = { from: vi.fn((t: string) => makeChain(t)), rpc: vi.fn() } as any

beforeEach(() => {
  state.queues = {}
  state.chains = {}
  state.fallback = { data: null, error: null }
  client.from.mockClear()
})

function item(id: string): PoolSnapshotItem {
  return {
    id, title: `T ${id}`, source_identifier: 'q', source_display_name: null, total_score: 1,
    bundle_type: null, metadata: null, content_length: 900, daily_repo_id: null, queued_at: '',
    source_pub_rate: 0, excerpt: `E ${id}`, hand: false, techmeme_story: null, techmeme_story_index: null,
  }
}

const items = ['a', 'b', 'c', 'd'].map(item)

describe('parseScoutOutput', () => {
  it('ignoriert fremde IDs; unter 50 % Abdeckung liefert null', () => {
    const ids = new Set(['a', 'b', 'c', 'd'])
    expect(
      parseScoutOutput({ cards: [{ id: 'a', core: 'x' }, { id: 'zz', core: 'y' }, { id: 'b', core: 'z' }] }, ids),
    ).toEqual(new Map([['a', 'x'], ['b', 'z']]))
    expect(parseScoutOutput({ cards: [{ id: 'a', core: 'x' }] }, ids)).toBeNull()
    expect(parseScoutOutput({ nope: 1 }, ids)).toBeNull()
  })
})

describe('scoutBatch', () => {
  it('liefert Cards und missing; bei CallInvalidError sind alle missing', async () => {
    const callTool = vi.fn(async (input: any) =>
      ({ result: input.validate({ cards: [{ id: 'a', core: 'A!' }, { id: 'b', core: 'B!' }, { id: 'c', core: 'C!' }] }), model: 'h', tokens: {} as any, costUsd: 0.01, retried: false, strictDropped: false }),
    )
    const r = await scoutBatch(callTool as any, items)
    expect(r.cards).toEqual([{ id: 'a', core: 'A!' }, { id: 'b', core: 'B!' }, { id: 'c', core: 'C!' }])
    expect(r.missing).toEqual(['d'])
    expect(r.costUsd).toBe(0.01)
    expect(callTool.mock.calls[0][0]).toMatchObject({ useCase: 'curation_scout', tool: SCOUT_TOOL, thinking: false, maxTokens: 4096 })

    const bad = vi.fn(async () => { throw new CallInvalidError('curation_scout', 0.02) })
    const r2 = await scoutBatch(bad as any, items)
    expect(r2.cards).toEqual([])
    expect(r2.missing).toEqual(['a', 'b', 'c', 'd'])
    // R24: beide Antworten waren bezahlt — die Fallback-Cards tragen die Kosten des Fehlers.
    expect(r2.costUsd).toBe(0.02)
  })

  it('R28 (Minor 2): CallRefusedError → Fallback wie CallInvalidError, mit Kosten, kein Wurf', async () => {
    const refused = vi.fn(async () => { throw new CallRefusedError('curation_scout', 'cyber', 0.01) })
    const r = await scoutBatch(refused as any, items)
    expect(r.cards).toEqual([])
    expect(r.missing).toEqual(['a', 'b', 'c', 'd'])
    expect(r.costUsd).toBe(0.01)
  })

  it('wirft andere Fehler weiter (kein eigener Retry)', async () => {
    const boom = vi.fn(async () => { throw new Error('boom') })
    await expect(scoutBatch(boom as any, items)).rejects.toThrow('boom')
  })
})

describe('Cache', () => {
  it('liest je Modell und schreibt per upsert', async () => {
    state.queues.curation_cards = [{ data: [{ item_id: 'a', core: 'aus Cache' }], error: null }, { data: null, error: null }]
    expect(await loadCachedCards(client, ['a', 'b'], 'h')).toEqual(new Map([['a', 'aus Cache']]))
    expect(state.chains.curation_cards[0].eq).toHaveBeenCalledWith('model', 'h')

    await saveCards(client, [{ id: 'b', core: 'neu' }], 'h')
    expect(state.chains.curation_cards[1].upsert).toHaveBeenCalledWith(
      [{ item_id: 'b', model: 'h', core: 'neu' }],
      { onConflict: 'item_id,model' },
    )
  })
})

it('batchesOf / fallbackCard', () => {
  expect(batchesOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  expect(fallbackCard(items[0])).toEqual({ id: 'a', core: 'T a' })
})
