/**
 * Tages-Pool as-of (Task 4, lib/curation/pool.ts). makeChain wie in
 * tests/lib/curation-service.test.ts, erweitert um `client.rpc` fuer
 * get_pool_excerpts.
 *
 * loadPostPublishTimes (lib/curation/precedents.ts) und loadEventsForItems
 * (lib/news-queue/events.ts) fragen bei leerer ID-Liste gar keine Tabelle an
 * (frueher return) — im loadPoolAsOf-Test tragen beide Zeilen
 * used_in_post_id: null, daher bleibt generated_posts unbenutzt; die
 * Hand-Kandidatenliste ist nicht leer, daher braucht queue_item_events eine
 * Queue-Antwort.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  filterPoolAsOf,
  isLiveAsOf,
  loadPoolAsOf,
  loadPoolEmbeddings,
  techmemeStoriesOf,
  toSnapshotItem,
  type PoolRawRow,
} from '@/lib/curation/pool'

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

const client = {
  from: vi.fn((t: string) => makeChain(t)),
  rpc: vi.fn(async () => ({ data: [], error: null })),
} as any

beforeEach(() => {
  state.queues = {}
  state.chains = {}
  state.fallback = { data: null, error: null }
  client.from.mockClear()
  client.rpc = vi.fn(async () => ({ data: [], error: null }))
})

const ASOF = '2026-10-15T04:25:00.000Z'

function row(p: Partial<PoolRawRow> & { id: string }): PoolRawRow {
  return {
    title: `Meldung ${p.id} mit genug Text`, source_identifier: 'src@x', source_display_name: null,
    total_score: 5, bundle_type: null, metadata: null, content_length: 2000, daily_repo_id: `repo-${p.id}`,
    queued_at: '2026-10-14T20:00:00.000Z', expires_at: '2026-10-16T20:00:00.000Z', used_in_post_id: null,
    status: 'pending', selected_at: null, source_pub_rate: 0.1, ...p,
  }
}

describe('filterPoolAsOf', () => {
  it('schliesst used_earlier, expired und (nur live) skipped aus; Junk und zu kurze fallen raus', () => {
    const rows = [
      row({ id: 'ok' }),
      row({ id: 'used', used_in_post_id: 'post-alt' }),
      row({ id: 'exp', expires_at: '2026-10-15T04:00:00.000Z' }),
      row({ id: 'skip', status: 'skipped' }),
      row({ id: 'junk', title: 'http://x.y/z' }),
      row({ id: 'short', content_length: 120 }),
    ]
    const postTimes = new Map([['post-alt', '2026-10-15T01:00:00.000Z']])
    const live = filterPoolAsOf(rows, ASOF, postTimes, { minContentLength: 500, live: true })
    expect(live.kept.map((r) => r.id)).toEqual(['ok'])
    expect(live.excluded).toEqual({ used_earlier: 1, expired: 1, skipped: 1, junk: 1, short: 1 })
    const past = filterPoolAsOf(rows, ASOF, postTimes, { minContentLength: 500, live: false })
    expect(past.kept.map((r) => r.id)).toEqual(['ok', 'skip']) // skipped ist historisch nicht rekonstruierbar
  })

  it('Techmeme-Items und Hand-Kandidaten ueberstehen Junk- und Laengenfilter', () => {
    const rows = [
      row({ id: 'tm', content_length: 100, daily_repo_id: null, metadata: { techmeme: true, techmeme_story: 'openai-dots', techmeme_story_index: 2 } }),
      row({ id: 'hand', content_length: 100, status: 'selected', selected_at: '2026-10-15T03:00:00.000Z' }),
      row({ id: 'later', content_length: 100, status: 'selected', selected_at: '2026-10-15T06:00:00.000Z' }),
    ]
    const r = filterPoolAsOf(rows, ASOF, new Map(), { minContentLength: 500, live: false })
    expect(r.kept.map((x) => x.id)).toEqual(['tm', 'hand'])
  })
})

describe('techmemeStoriesOf', () => {
  it('gruppiert nach techmeme_story, Member nach total_score, index = kleinster story_index', () => {
    const items = [
      toSnapshotItem(row({ id: 'a', total_score: 3, metadata: { techmeme: true, techmeme_story: 's1', techmeme_story_index: 1 } }), 'x', false),
      toSnapshotItem(row({ id: 'b', total_score: 9, metadata: { techmeme: true, techmeme_story: 's1', techmeme_story_index: 1 } }), 'x', false),
      toSnapshotItem(row({ id: 'c', total_score: 1, metadata: { techmeme: true, techmeme_story: 's2', techmeme_story_index: 4 } }), 'x', false),
      toSnapshotItem(row({ id: 'd' }), 'x', false),
    ]
    expect(techmemeStoriesOf(items)).toEqual([
      { story: 's1', index: 1, member_ids: ['b', 'a'] },
      { story: 's2', index: 4, member_ids: ['c'] },
    ])
  })
})

describe('isLiveAsOf', () => {
  it('live innerhalb 15 Minuten um jetzt', () => {
    const now = Date.parse(ASOF)
    expect(isLiveAsOf(ASOF, now + 5 * 60_000)).toBe(true)
    expect(isLiveAsOf(ASOF, now + 16 * 60_000)).toBe(false)
  })
})

describe('loadPoolAsOf', () => {
  it('liest das 48-h-Fenster seitenweise, holt Excerpts per RPC und den Hand-Begriff aus Events', async () => {
    state.queues.news_queue = [{
      data: [row({ id: 'ok' }), row({ id: 'hand', status: 'selected', selected_at: '2026-10-15T03:00:00.000Z' })],
      error: null,
    }]
    client.rpc = vi.fn(async () => ({
      data: [{ id: 'ok', excerpt: 'Auszug ok' }, { id: 'hand', excerpt: 'Auszug hand' }], error: null,
    }))
    state.queues.queue_item_events = [{
      data: [{ id: 1, queue_item_id: 'hand', event: 'select', actor: 'operator', to_status: 'selected', at: '2026-10-15T03:00:00.000Z' }],
      error: null,
    }]
    const snap = await loadPoolAsOf(client, { asOf: ASOF, minContentLength: 500, windowHours: 48 })
    const q = state.chains.news_queue[0]
    expect(q.gte).toHaveBeenCalledWith('queued_at', '2026-10-13T04:25:00.000Z')
    expect(q.lt).toHaveBeenCalledWith('queued_at', ASOF)
    expect(q.range).toHaveBeenCalledWith(0, 999)
    expect(client.rpc).toHaveBeenCalledWith('get_pool_excerpts', { ids: ['ok', 'hand'], max_chars: 1500 })
    expect(snap.items.find((i) => i.id === 'ok')?.excerpt).toBe('Auszug ok')
    expect(snap.handIds).toEqual(['hand'])
    expect(snap.items.find((i) => i.id === 'hand')?.hand).toBe(true)
  })
})

describe('loadPoolEmbeddings', () => {
  it('nutzt daily_repo, dann den Cache, erzeugt den Rest und schreibt ihn in den Cache', async () => {
    const items = [
      toSnapshotItem(row({ id: 'r1' }), 'x', false), // repo-r1 hat Embedding
      toSnapshotItem(row({ id: 'c1', daily_repo_id: null }), 'x', false), // im Cache
      toSnapshotItem(row({ id: 'n1', daily_repo_id: null }), 'Neu', false), // on-the-fly
    ]
    state.queues.daily_repo = [{ data: [{ id: 'repo-r1', embedding: JSON.stringify([1, 0, 0]) }], error: null }]
    state.queues.curation_item_embeddings = [
      { data: [{ item_id: 'c1', embedding: '[0,1,0]' }], error: null },
      { data: null, error: null },
    ]
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [0, 0, 1]))
    const res = await loadPoolEmbeddings(client, items, embed)
    expect([...res.embeddings.keys()].sort()).toEqual(['c1', 'n1', 'r1'])
    expect(res.generated).toBe(1)
    expect(res.failed).toBe(0)
    expect(embed).toHaveBeenCalledWith([expect.stringContaining('Neu')])
    expect(state.chains.curation_item_embeddings[1].upsert).toHaveBeenCalledWith(
      [{ item_id: 'n1', embedding: '[0,0,1]' }], { onConflict: 'item_id' },
    )
  })

  it('bricht nach 3 aufeinanderfolgenden embed()-Fehlern mit Error ab', async () => {
    // 48 Items ohne daily_repo- und Cache-Treffer = 3 Batches à 16 — jeder
    // embed()-Aufruf wirft, der Guard (createEmbedFailGuard) zaehlt 3 in
    // Folge und bricht ab, statt den Lauf mit lauter leeren Embeddings
    // weiterzuschicken.
    const items = Array.from({ length: 48 }, (_, i) => toSnapshotItem(row({ id: `m${i}`, daily_repo_id: null }), 'x', false))
    state.queues.curation_item_embeddings = [{ data: [], error: null }]
    const embed = vi.fn(async () => { throw new Error('API down') })
    await expect(loadPoolEmbeddings(client, items, embed)).rejects.toThrow(/^embeddings: /)
    expect(embed).toHaveBeenCalledTimes(3)
  })
})
