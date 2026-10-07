/**
 * Queue-Events aus den Status-Setzern in lib/news-queue/service.ts.
 *
 * Betreiber-Vorgabe 2026-10-05: Jeder Statuswechsel in news_queue hinterlässt
 * ein Event mit Akteur — daraus entsteht die Herkunft je Item (origin.ts).
 * Geprüft wird, DASS jeder Setzer recordQueueEvents mit den richtigen Feldern
 * ruft, dass der Snapshot VOR dem Update liegt, und dass der Setzer auch ohne
 * Events weiterläuft (Hooks sind best-effort).
 *
 * Mock-Muster wie glossary-jobs-service.test.ts (makeChain mit FIFO-Queue je
 * Tabelle). Das Events-Modul (Task 3) ist gemockt, damit dieser Test nur die
 * Hooks prüft und nicht an dessen eigener Query-Kette hängt.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { QueueEvent } from '@/lib/news-queue/events'

const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  fallback: { data: null as unknown, error: null as unknown },
  chains: {} as Record<string, any[]>,
}))

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  recordQueueEvents: vi.fn(async (_supabase: unknown, _events: QueueEvent[]): Promise<void> => {}),
  readStatusSnapshot: vi.fn(
    async (_supabase: unknown, _ids: string[]) => new Map<string, { status: string; bundle_type: string | null }>(),
  ),
}))

function makeChain(table: string) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'in', 'is', 'or', 'lt', 'gt', 'gte', 'not', 'order', 'limit', 'range', 'update', 'insert', 'upsert', 'delete']) {
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
  createAdminClient: () => ({
    from: vi.fn((table: string) => makeChain(table)),
    rpc: mocks.rpc,
  }),
}))

vi.mock('@/lib/news-queue/events', () => ({
  recordQueueEvents: mocks.recordQueueEvents,
  readStatusSnapshot: mocks.readStatusSnapshot,
}))

import {
  selectItemsForArticle,
  markItemsAsUsed,
  skipItems,
  expireOldItems,
  resetSelectedToPending,
  resetStuckSelectedItems,
  addToQueue,
  syncPublishedPostsQueueItems,
} from '@/lib/news-queue/service'

/** Alle Events aller recordQueueEvents-Aufrufe, flach und in Aufrufreihenfolge. */
function recordedEvents(): QueueEvent[] {
  return mocks.recordQueueEvents.mock.calls.flatMap((args) => args[1])
}

beforeEach(() => {
  state.queues = {}
  state.chains = {}
  state.fallback = { data: null, error: null }
  mocks.rpc.mockReset()
  mocks.recordQueueEvents.mockReset()
  mocks.readStatusSnapshot.mockReset()
  mocks.readStatusSnapshot.mockResolvedValue(new Map())
})

describe('selectItemsForArticle', () => {
  it('schreibt je umgestellter Zeile ein select-Event mit dem übergebenen Akteur', async () => {
    mocks.readStatusSnapshot.mockResolvedValue(new Map([
      ['a', { status: 'pending', bundle_type: null }],
      ['b', { status: 'pending', bundle_type: 'topic' }],
    ]))
    state.queues.news_queue = [{
      data: [
        { id: 'a', status: 'selected', bundle_type: null },
        { id: 'b', status: 'selected', bundle_type: 'topic' },
      ],
      error: null,
    }]

    const res = await selectItemsForArticle(['a', 'b', 'c'], { actor: 'pipeline' })

    expect(res.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(mocks.readStatusSnapshot).toHaveBeenCalledWith(expect.anything(), ['a', 'b', 'c'])
    // Nur die wirklich umgestellten Zeilen bekommen ein Event — 'c' war nicht pending.
    expect(recordedEvents()).toEqual([
      { queue_item_id: 'a', event: 'select', actor: 'pipeline', from_status: 'pending', to_status: 'selected', from_role: null, to_role: null },
      { queue_item_id: 'b', event: 'select', actor: 'pipeline', from_status: 'pending', to_status: 'selected', from_role: 'topic', to_role: 'topic' },
    ])
    // Snapshot VOR dem Update: danach stünde in jeder Zeile schon 'selected'.
    const chain = state.chains.news_queue[0]
    expect(mocks.readStatusSnapshot.mock.invocationCallOrder[0]).toBeLessThan(chain.update.mock.invocationCallOrder[0])
  })

  it('schreibt bei DB-Fehler kein Event und gibt den Fehler wie bisher zurück', async () => {
    state.queues.news_queue = [{ data: null, error: { message: 'boom' } }]

    const res = await selectItemsForArticle(['a'], { actor: 'operator' })

    expect(res).toEqual({ items: [], error: 'boom' })
    expect(mocks.recordQueueEvents).not.toHaveBeenCalled()
  })

  it('leerer Snapshot (z. B. nach Lesefehler in readStatusSnapshot): from_status bleibt pending (Update-Filter)', async () => {
    // readStatusSnapshot wirft nie (Task 3) — ein Lesefehler zeigt sich als leere Map.
    mocks.readStatusSnapshot.mockResolvedValue(new Map())
    state.queues.news_queue = [{ data: [{ id: 'a', status: 'selected', bundle_type: null }], error: null }]

    const res = await selectItemsForArticle(['a'], { actor: 'operator' })

    expect(res.items).toHaveLength(1)
    expect(recordedEvents()[0]).toMatchObject({ queue_item_id: 'a', actor: 'operator', from_status: 'pending', from_role: null })
  })

  it('ohne IDs: leere Liste, kein Event', async () => {
    state.queues.news_queue = [{ data: [], error: null }]

    const res = await selectItemsForArticle([], { actor: 'pipeline' })

    expect(res).toEqual({ items: [] })
    expect(recordedEvents()).toEqual([])
  })
})

describe('markItemsAsUsed', () => {
  it('schreibt use-Events mit Default-Akteur pipeline und optionalem Grund', async () => {
    mocks.readStatusSnapshot.mockResolvedValue(new Map([['a', { status: 'selected', bundle_type: 'recap' }]]))
    state.queues.news_queue = [{ data: [{ id: 'a' }], error: null }]

    const res = await markItemsAsUsed(['a'], 'post-1', { reason: 'sync' })

    expect(res).toEqual({ updated: 1 })
    expect(recordedEvents()).toEqual([
      { queue_item_id: 'a', event: 'use', actor: 'pipeline', from_status: 'selected', to_status: 'used', from_role: 'recap', to_role: 'recap', reason: 'sync' },
    ])
    const chain = state.chains.news_queue[0]
    expect(chain.update).toHaveBeenCalledWith({ status: 'used', used_in_post_id: 'post-1' })
    expect(mocks.readStatusSnapshot.mock.invocationCallOrder[0]).toBeLessThan(chain.update.mock.invocationCallOrder[0])
  })

  it('nimmt den übergebenen Akteur; ohne Grund steht reason auf null', async () => {
    state.queues.news_queue = [{ data: [{ id: 'a' }], error: null }]

    await markItemsAsUsed(['a'], 'post-1', { actor: 'operator' })

    expect(recordedEvents()[0]).toMatchObject({ actor: 'operator', reason: null, from_status: null })
  })

  it('ohne IDs: kein DB-Zugriff, kein Event', async () => {
    const res = await markItemsAsUsed([], 'post-1')

    expect(res).toEqual({ updated: 0 })
    expect(state.chains.news_queue).toBeUndefined()
    expect(mocks.readStatusSnapshot).not.toHaveBeenCalled()
    expect(mocks.recordQueueEvents).not.toHaveBeenCalled()
  })

  it('schreibt bei DB-Fehler kein Event', async () => {
    state.queues.news_queue = [{ data: null, error: { message: 'boom' } }]

    const res = await markItemsAsUsed(['a'], 'post-1')

    expect(res).toEqual({ updated: 0, error: 'boom' })
    expect(mocks.recordQueueEvents).not.toHaveBeenCalled()
  })
})

describe('skipItems', () => {
  it('schreibt skip-Events mit Grund, Default-Akteur operator, nur für getroffene Zeilen', async () => {
    mocks.readStatusSnapshot.mockResolvedValue(new Map([['a', { status: 'pending', bundle_type: null }]]))
    state.queues.news_queue = [{ data: [{ id: 'a' }], error: null }]

    await skipItems(['a', 'gibt-es-nicht'], 'junk')

    const chain = state.chains.news_queue[0]
    expect(chain.update).toHaveBeenCalledWith({ status: 'skipped', skip_reason: 'junk' })
    expect(chain.in).toHaveBeenCalledWith('id', ['a', 'gibt-es-nicht'])
    expect(chain.select).toHaveBeenCalledWith('id')
    expect(recordedEvents()).toEqual([
      { queue_item_id: 'a', event: 'skip', actor: 'operator', from_status: 'pending', to_status: 'skipped', from_role: null, to_role: null, reason: 'junk' },
    ])
    // WARUM: Der Snapshot muss VOR dem Update liegen — danach stünde in Prod
    // schon 'skipped' als from_status. Der Mock liefert reihenfolgeunabhängig
    // 'pending', nur die Aufrufreihenfolge deckt das auf.
    expect(mocks.readStatusSnapshot.mock.invocationCallOrder[0]).toBeLessThan(chain.update.mock.invocationCallOrder[0])
  })

  it('nimmt den übergebenen Akteur', async () => {
    state.queues.news_queue = [{ data: [{ id: 'a' }], error: null }]

    await skipItems(['a'], 'dedup', { actor: 'pipeline' })

    expect(recordedEvents()[0]).toMatchObject({ event: 'skip', actor: 'pipeline', reason: 'dedup' })
  })

  it('schreibt bei DB-Fehler kein Event und wirft nicht (Regressionsschutz)', async () => {
    // skipItems ignoriert den Update-Fehler schon heute (Rückgabe void) —
    // der Hook darf daraus weder ein Event noch einen Wurf machen.
    state.queues.news_queue = [{ data: null, error: { message: 'boom' } }]

    await expect(skipItems(['a'], 'junk')).resolves.toBeUndefined()
    expect(recordedEvents()).toEqual([])
  })
})

describe('syncPublishedPostsQueueItems', () => {
  it('verbucht Cron-Nachzügler als use-Event mit actor pipeline und reason sync', async () => {
    // 1. generated_posts-Select (published mit pending_queue_item_ids);
    //    das anschließende generated_posts-Update läuft auf den Fallback.
    state.queues.generated_posts = [{ data: [{ id: 'post-1', pending_queue_item_ids: ['a'] }], error: null }]
    state.queues.news_queue = [{ data: [{ id: 'a' }], error: null }]

    const res = await syncPublishedPostsQueueItems()

    expect(res).toEqual({ processed: 1, itemsMarked: 1 })
    expect(recordedEvents()).toEqual([
      { queue_item_id: 'a', event: 'use', actor: 'pipeline', from_status: null, to_status: 'used', from_role: null, to_role: null, reason: 'sync' },
    ])
  })
})

describe('expireOldItems', () => {
  type Snap = Map<string, { status: string; bundle_type: string | null }>
  /** Nachkontrolle, in der jede übergebene ID jetzt auf 'expired' steht (optional mit Label). */
  const alleVerfallen = (rollen: Record<string, string> = {}) =>
    async (_supabase: unknown, ids: string[]): Promise<Snap> =>
      new Map(ids.map((id): [string, { status: string; bundle_type: string | null }] => [
        id,
        { status: 'expired', bundle_type: rollen[id] ?? null },
      ]))

  it('liest Kandidaten VOR dem RPC, prüft danach den Status und schreibt expire-Events (pipeline)', async () => {
    state.queues.news_queue = [{ data: [{ id: 'a' }, { id: 'b' }], error: null }]
    mocks.rpc.mockResolvedValue({ data: 2, error: null })
    mocks.readStatusSnapshot.mockImplementation(alleVerfallen({ b: 'topic' }))

    const n = await expireOldItems()

    expect(n).toBe(2)
    expect(mocks.rpc).toHaveBeenCalledWith('expire_old_queue_items')
    // Dasselbe Prädikat wie expire_old_queue_items
    // (20260127100000_reduce_queue_expiry.sql:58-71): status='pending' AND expires_at < now().
    const read = state.chains.news_queue[0]
    expect(read.select).toHaveBeenCalledWith('id')
    expect(read.eq).toHaveBeenCalledWith('status', 'pending')
    expect(read.lt).toHaveBeenCalledWith('expires_at', expect.any(String))
    // Stabile Reihenfolge über Seiten: ohne ORDER BY garantiert Postgres keine.
    expect(read.order).toHaveBeenCalledWith('id')
    expect(read.range).toHaveBeenCalledWith(0, 999)
    // Reihenfolge: Vorab-Select → RPC → Nachkontrolle (Review Focus 5).
    expect(mocks.readStatusSnapshot).toHaveBeenCalledWith(expect.anything(), ['a', 'b'])
    expect(read.select.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0])
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.readStatusSnapshot.mock.invocationCallOrder[0])
    expect(recordedEvents()).toEqual([
      { queue_item_id: 'a', event: 'expire', actor: 'pipeline', from_status: 'pending', to_status: 'expired', from_role: null, to_role: null, reason: 'Auto-expired after 2 days' },
      { queue_item_id: 'b', event: 'expire', actor: 'pipeline', from_status: 'pending', to_status: 'expired', from_role: 'topic', to_role: 'topic', reason: 'Auto-expired after 2 days' },
    ])
  })

  it('Nachkontrolle: Kandidat, der zwischen Vorab-Select und RPC selected wurde, bekommt kein Event', async () => {
    // Plan-Kopf Review Focus 5: Events nur für Items, die danach wirklich
    // 'expired' sind. 'b' wurde zwischendurch gewählt — der RPC ließ es wegen
    // status='pending' liegen (oder das Prod-Prädikat weicht ab).
    state.queues.news_queue = [{ data: [{ id: 'a' }, { id: 'b' }], error: null }]
    mocks.rpc.mockResolvedValue({ data: 1, error: null })
    mocks.readStatusSnapshot.mockResolvedValue(new Map([
      ['a', { status: 'expired', bundle_type: null }],
      ['b', { status: 'selected', bundle_type: 'topic' }],
    ]))

    expect(await expireOldItems()).toBe(1)

    expect(recordedEvents()).toEqual([
      { queue_item_id: 'a', event: 'expire', actor: 'pipeline', from_status: 'pending', to_status: 'expired', from_role: null, to_role: null, reason: 'Auto-expired after 2 days' },
    ])
  })

  it('Nachkontrolle nicht lesbar (leerer Snapshot): kein Event, Zähler des RPC bleibt', async () => {
    // readStatusSnapshot wirft nie (Task 3) — ein Lesefehler zeigt sich als
    // leere Map (beforeEach-Default). Lieber ein fehlendes Event als ein falsches.
    state.queues.news_queue = [{ data: [{ id: 'a' }], error: null }]
    mocks.rpc.mockResolvedValue({ data: 1, error: null })

    expect(await expireOldItems()).toBe(1)

    expect(mocks.readStatusSnapshot).toHaveBeenCalledWith(expect.anything(), ['a'])
    expect(recordedEvents()).toEqual([])
  })

  it('liest mehr als 1000 Kandidaten seitenweise (PostgREST-Cap), bricht nach der kurzen Seite ab und kontrolliert alle', async () => {
    const seite1 = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}` }))
    state.queues.news_queue = [
      { data: seite1, error: null },
      { data: [{ id: 'letzte' }], error: null },
    ]
    mocks.rpc.mockResolvedValue({ data: 1001, error: null })
    mocks.readStatusSnapshot.mockImplementation(alleVerfallen({ letzte: 'topic' }))

    expect(await expireOldItems()).toBe(1001)

    expect(state.chains.news_queue).toHaveLength(2)
    expect(state.chains.news_queue[0].order).toHaveBeenCalledWith('id')
    expect(state.chains.news_queue[0].range).toHaveBeenCalledWith(0, 999)
    expect(state.chains.news_queue[1].order).toHaveBeenCalledWith('id')
    expect(state.chains.news_queue[1].range).toHaveBeenCalledWith(1000, 1999)
    // EIN Aufruf mit allen Kandidaten — die Scheiben à 200 schneidet readStatusSnapshot selbst (Task 3).
    expect(mocks.readStatusSnapshot).toHaveBeenCalledTimes(1)
    expect(mocks.readStatusSnapshot.mock.calls[0][1]).toHaveLength(1001)
    const events = recordedEvents()
    expect(events).toHaveLength(1001)
    expect(events[1000]).toMatchObject({ queue_item_id: 'letzte', event: 'expire', from_role: 'topic' })
  })

  it('schreibt kein Event und kontrolliert nicht nach, wenn der RPC scheitert (Kandidaten wurden trotzdem vorab gelesen)', async () => {
    state.queues.news_queue = [{ data: [{ id: 'a' }], error: null }]
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'kaputt' } })

    expect(await expireOldItems()).toBe(0)
    // Der Vorab-Select liegt VOR dem RPC — er läuft also auch, wenn der RPC scheitert.
    expect(state.chains.news_queue).toHaveLength(1)
    expect(mocks.readStatusSnapshot).not.toHaveBeenCalled()
    expect(mocks.recordQueueEvents).not.toHaveBeenCalled()
  })

  it('führt den RPC auch aus, wenn die Kandidaten nicht lesbar sind (Hook best-effort)', async () => {
    state.queues.news_queue = [{ data: null, error: { message: 'offline' } }]
    mocks.rpc.mockResolvedValue({ data: 3, error: null })
    // Selbst wenn die Nachkontrolle alles als expired meldete: ohne Kandidaten kein Event.
    mocks.readStatusSnapshot.mockImplementation(alleVerfallen())

    expect(await expireOldItems()).toBe(3)
    // Genau ein Leseversuch, kein Weiterblättern nach dem Fehler.
    expect(state.chains.news_queue).toHaveLength(1)
    expect(recordedEvents()).toEqual([])
  })

  it('Lesefehler auf einer Folgeseite verwirft ALLE Kandidaten — kein Teil-Event-Satz, RPC läuft', async () => {
    const seite1 = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}` }))
    state.queues.news_queue = [
      { data: seite1, error: null },
      { data: null, error: { message: 'offline' } },
    ]
    mocks.rpc.mockResolvedValue({ data: 1000, error: null })
    // Meldete die Nachkontrolle alle als expired, entstünden ohne Verwerfen 1000 Events.
    mocks.readStatusSnapshot.mockImplementation(alleVerfallen())

    expect(await expireOldItems()).toBe(1000)
    expect(state.chains.news_queue).toHaveLength(2)
    expect(recordedEvents()).toEqual([])
  })
})

describe('resetSelectedToPending', () => {
  it('schreibt reset-Events für alle zurückgesetzten Zeilen, Default-Akteur operator', async () => {
    state.queues.news_queue = [{ data: [{ id: 'a', bundle_type: 'topic' }, { id: 'b', bundle_type: null }], error: null }]

    expect(await resetSelectedToPending()).toBe(2)

    const chain = state.chains.news_queue[0]
    expect(chain.update).toHaveBeenCalledWith({ status: 'pending', selected_at: null })
    expect(chain.eq).toHaveBeenCalledWith('status', 'selected')
    expect(chain.select).toHaveBeenCalledWith('id, bundle_type')
    expect(recordedEvents()).toEqual([
      { queue_item_id: 'a', event: 'reset', actor: 'operator', from_status: 'selected', to_status: 'pending', from_role: 'topic', to_role: 'topic' },
      { queue_item_id: 'b', event: 'reset', actor: 'operator', from_status: 'selected', to_status: 'pending', from_role: null, to_role: null },
    ])
  })

  it('nimmt den übergebenen Akteur', async () => {
    state.queues.news_queue = [{ data: [{ id: 'a', bundle_type: null }], error: null }]

    await resetSelectedToPending({ actor: 'agent' })

    expect(recordedEvents()[0]).toMatchObject({ event: 'reset', actor: 'agent' })
  })

  it('schreibt bei DB-Fehler kein Event (Label wird trotzdem in derselben Abfrage angefragt)', async () => {
    state.queues.news_queue = [{ data: null, error: { message: 'boom' } }]

    expect(await resetSelectedToPending()).toBe(0)
    expect(state.chains.news_queue[0].select).toHaveBeenCalledWith('id, bundle_type')
    expect(mocks.recordQueueEvents).not.toHaveBeenCalled()
  })
})

describe('resetStuckSelectedItems', () => {
  it('schreibt stuck_reset-Events (pipeline) nur für die wirklich zurückgesetzten Zeilen', async () => {
    state.queues.news_queue = [
      // 1. Kandidaten-Select (status=selected, selected_at < cutoff)
      { data: [{ id: 'a', bundle_type: null }, { id: 'b', bundle_type: 'recap' }], error: null },
      // 2. Update der nicht geschützten IDs
      { data: [{ id: 'b' }], error: null },
    ]
    // 'a' ist Panel-akzeptiert und bleibt geschützt
    state.queues.ranking_suggestions = [{ data: [{ queue_item_id: 'a' }], error: null }]

    expect(await resetStuckSelectedItems(24)).toBe(1)

    const read = state.chains.news_queue[0]
    expect(read.select).toHaveBeenCalledWith('id, bundle_type')
    const upd = state.chains.news_queue[1]
    expect(upd.in).toHaveBeenCalledWith('id', ['b'])
    expect(recordedEvents()).toEqual([
      { queue_item_id: 'b', event: 'stuck_reset', actor: 'pipeline', from_status: 'selected', to_status: 'pending', from_role: 'recap', to_role: 'recap' },
    ])
  })

  it('ohne Kandidaten: kein Update, kein Event', async () => {
    state.queues.news_queue = [{ data: [], error: null }]

    expect(await resetStuckSelectedItems(24)).toBe(0)
    expect(state.chains.news_queue).toHaveLength(1)
    expect(state.chains.news_queue[0].select).toHaveBeenCalledWith('id, bundle_type')
    expect(mocks.recordQueueEvents).not.toHaveBeenCalled()
  })

  it('nur geschützte Kandidaten: kein Update, kein Event', async () => {
    state.queues.news_queue = [{ data: [{ id: 'a', bundle_type: null }], error: null }]
    state.queues.ranking_suggestions = [{ data: [{ queue_item_id: 'a' }], error: null }]

    expect(await resetStuckSelectedItems(24)).toBe(0)
    expect(state.chains.news_queue).toHaveLength(1)
    expect(state.chains.news_queue[0].select).toHaveBeenCalledWith('id, bundle_type')
    expect(mocks.recordQueueEvents).not.toHaveBeenCalled()
  })

  it('schreibt bei Update-Fehler kein Event', async () => {
    state.queues.news_queue = [
      { data: [{ id: 'a', bundle_type: null }], error: null },
      { data: null, error: { message: 'boom' } },
    ]

    expect(await resetStuckSelectedItems(24)).toBe(0)
    expect(state.chains.news_queue).toHaveLength(2)
    expect(state.chains.news_queue[0].select).toHaveBeenCalledWith('id, bundle_type')
    expect(mocks.recordQueueEvents).not.toHaveBeenCalled()
  })
})

describe('addToQueue', () => {
  const RETURNING = 'id, daily_repo_id, source_url, bundle_type, status'

  it('schreibt select-Events nur für Items mit Anfangsstatus selected; Techmeme-Themen als techmeme, sonst operator', async () => {
    state.queues.newsletter_sources = [{ data: [], error: null }]
    // Upsert-Rückgabe: Zuordnung zum Eingabe-Item über daily_repo_id bzw. source_url
    state.queues.news_queue = [{
      data: [
        { id: 'q1', daily_repo_id: null, source_url: 'https://x/1', bundle_type: 'topic', status: 'selected' },
        { id: 'q2', daily_repo_id: 'repo-2', source_url: null, bundle_type: null, status: 'selected' },
        { id: 'q3', daily_repo_id: 'repo-3', source_url: null, bundle_type: null, status: 'pending' },
      ],
      error: null,
    }]

    const res = await addToQueue([
      { title: 'Thema des Tages', sourceUrl: 'https://x/1', bundleType: 'topic', status: 'selected', metadata: { techmeme: true } },
      { title: 'Manuell gewählt', dailyRepoId: 'repo-2', status: 'selected' },
      { title: 'Normal pending', dailyRepoId: 'repo-3' },
    ])

    expect(res.added).toBe(3)
    const upsert = state.chains.news_queue[0]
    expect(upsert.select).toHaveBeenCalledWith(RETURNING)
    expect(recordedEvents()).toEqual([
      { queue_item_id: 'q1', event: 'select', actor: 'techmeme', from_status: null, to_status: 'selected', from_role: null, to_role: 'topic' },
      { queue_item_id: 'q2', event: 'select', actor: 'operator', from_status: null, to_status: 'selected', from_role: null, to_role: null },
    ])
  })

  it('gleiche source_url als Thema (selected) und als pending im selben Lauf: nur die selected-Zeile bekommt ein Event', async () => {
    // Techmeme kann dieselbe Quelle in zwei Stories führen; filterKnownSources
    // gleicht nur gegen die DB und innerhalb einer Story ab
    // (lib/techmeme/queue-items.ts:169-179, job.ts:329).
    state.queues.newsletter_sources = [{ data: [], error: null }]
    state.queues.news_queue = [{
      data: [
        { id: 'q1', daily_repo_id: null, source_url: 'https://x/1', bundle_type: 'topic', status: 'selected' },
        { id: 'q2', daily_repo_id: null, source_url: 'https://x/1', bundle_type: null, status: 'pending' },
      ],
      error: null,
    }]

    await addToQueue([
      { title: 'Thema des Tages', sourceUrl: 'https://x/1', bundleType: 'topic', status: 'selected', metadata: { techmeme: true } },
      { title: 'Andere Story, gleiche Quelle', sourceUrl: 'https://x/1', status: 'pending', metadata: { techmeme: true } },
    ])

    expect(recordedEvents()).toEqual([
      { queue_item_id: 'q1', event: 'select', actor: 'techmeme', from_status: null, to_status: 'selected', from_role: null, to_role: 'topic' },
    ])
  })

  it('ohne selected-Items: kein Event (Rückgabe trotzdem mit Status angefragt)', async () => {
    state.queues.news_queue = [{ data: [{ id: 'q3', daily_repo_id: 'repo-3', source_url: null, bundle_type: null, status: 'pending' }], error: null }]

    await addToQueue([{ title: 'Normal pending', dailyRepoId: 'repo-3' }])

    expect(state.chains.news_queue[0].select).toHaveBeenCalledWith(RETURNING)
    expect(recordedEvents()).toEqual([])
  })

  it('Einzel-Insert-Fallback nach Upsert-Fehler liefert ebenfalls Events', async () => {
    state.queues.newsletter_sources = [{ data: [], error: null }]
    state.queues.news_queue = [
      { data: null, error: { message: 'upsert kaputt' } },
      { data: [{ id: 'q1', daily_repo_id: null, source_url: 'https://x/1', bundle_type: 'topic', status: 'selected' }], error: null },
    ]

    const res = await addToQueue([
      { title: 'Thema des Tages', sourceUrl: 'https://x/1', bundleType: 'topic', status: 'selected', metadata: { techmeme: true } },
    ])

    expect(res.added).toBe(1)
    expect(recordedEvents()).toEqual([
      { queue_item_id: 'q1', event: 'select', actor: 'techmeme', from_status: null, to_status: 'selected', from_role: null, to_role: 'topic' },
    ])
  })

  it('Einzel-Insert-Fallback mit Duplikat (23505): skipped, kein Event', async () => {
    state.queues.newsletter_sources = [{ data: [], error: null }]
    state.queues.news_queue = [
      { data: null, error: { message: 'upsert kaputt' } },
      { data: null, error: { code: '23505', message: 'duplicate key' } },
    ]

    const res = await addToQueue([
      { title: 'Thema des Tages', sourceUrl: 'https://x/1', bundleType: 'topic', status: 'selected', metadata: { techmeme: true } },
    ])

    expect(res).toEqual({ added: 0, skipped: 1, errors: [] })
    // Auch der Einzel-Insert fragt die Rückgabezeile an — sonst gäbe es im
    // Erfolgsfall keine ID für das Event.
    expect(state.chains.news_queue[1].select).toHaveBeenCalledWith(RETURNING)
    expect(recordedEvents()).toEqual([])
  })

  it('selected-Item ohne dailyRepoId und sourceUrl: kein Zuordnungsschlüssel, kein Event (bewusste Lücke)', async () => {
    state.queues.news_queue = [{ data: [{ id: 'q9', daily_repo_id: null, source_url: null, bundle_type: null, status: 'selected' }], error: null }]

    const res = await addToQueue([{ title: 'Ohne Schlüssel', status: 'selected' }])

    expect(res.added).toBe(1)
    expect(state.chains.news_queue[0].select).toHaveBeenCalledWith(RETURNING)
    expect(recordedEvents()).toEqual([])
  })
})
