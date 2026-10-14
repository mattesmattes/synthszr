/**
 * Archivbrief (Task 7, lib/curation/archive.ts): Betreiber-Regeln,
 * Rollen-Soft-Range, Coverage as-of, Praezedenz-RPC, Negativ-Block,
 * Korrektur-Paare, Panel. makeChain wie tests/lib/curation-service.test.ts
 * (Supabase-Service-Tests), erweitert um `client.rpc` fuer get_precedent_units.
 *
 * loadNegativeBlock (lib/curation/negatives.ts) ist in den buildArchiveBrief-
 * Tests ECHT importiert, nicht gemockt -- mit state.fallback = { data: [],
 * error: null } fuer curation_precedents liefert sie sofort einen leeren
 * Block (precedents.length === 0), ohne weitere Tabellen zu beruehren.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildArchiveBrief,
  coverageHits,
  formatBrief,
  loadCoverageAsOf,
  loadCorrectionPairs,
  loadOperatorRules,
  loadPanelFeedback,
  loadPrecedentUnits,
  loadRoleSoftRange,
  loadTechmemeAdoption,
  roleSoftRange,
  techmemeAdoptionOf,
} from '@/lib/curation/archive'

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
  client.rpc = vi.fn(async () => ({ data: [], error: null }))
})

describe('roleSoftRange', () => {
  it('min/median/max je Rolle ueber Posts; Posts ohne die Rolle zaehlen 0', () => {
    const r = roleSoftRange([['topic', 'topic', null], ['topic', 'recap', null, null], [null, null]])
    expect(r.topic).toEqual({ min: 0, median: 1, max: 2 })
    expect(r.recap).toEqual({ min: 0, median: 0, max: 1 })
    expect(r.none).toEqual({ min: 1, median: 2, max: 2 })
  })
})

describe('coverageHits', () => {
  it('ran ab 0,8, followups 0,6-0,8, je Kandidat nur der beste Treffer', () => {
    const cands = [{ id: 'a', title: 'A', embedding: [1, 0, 0] }, { id: 'b', title: 'B', embedding: [0, 1, 0] }]
    const cov = [
      { id: 'u1', post_id: 'p', heading: 'Lief schon', published_at: '2026-10-12T05:00:00.000Z', embedding: [0.99, 0.1, 0] },
      { id: 'u2', post_id: 'p', heading: 'Aehnlich', published_at: '2026-10-11T05:00:00.000Z', embedding: [0.7, 0.714, 0] },
      { id: 'u3', post_id: 'p', heading: 'Egal', published_at: '2026-10-11T05:00:00.000Z', embedding: [0, 0, 1] },
    ]
    const r = coverageHits(cands, cov)
    expect(r.ran.map(x => [x.candidate_id, x.heading])).toEqual([['a', 'Lief schon']])
    expect(r.followups.map(x => [x.candidate_id, x.heading])).toEqual([['b', 'Aehnlich']])
  })
})

describe('techmemeAdoptionOf', () => {
  it('Uebernahmequote je Story-Rang', () => {
    expect(techmemeAdoptionOf([{ story_index: 0, status: 'used' }, { story_index: 0, status: 'expired' }, { story_index: 3, status: 'expired' }]))
      .toEqual([{ index: 0, stories: 2, used: 1, rate: 0.5 }, { index: 3, stories: 1, used: 0, rate: 0 }])
  })
})

describe('formatBrief', () => {
  it('nummeriert Praezedenzen als P<n>, kappt Paare auf 60 und Panel auf 5 je Rolle und Seite', () => {
    const precedents = Array.from({ length: 3 }, (_, i) => ({ unit_id: `u${i}`, post_id: 'p', heading: `H${i}`, bundle_type: 'topic', published_at: '2026-10-10T05:00:00.000Z', similarity: 0.9 - i / 10, candidate_index: 0 }))
    const pairs = Array.from({ length: 80 }, (_, i) => ({ outcome: 'dropped_never_selected' as const, title: `T${i}`, role: null, final_role: null, day: '2026-10-10', heading: null }))
    const panel = { accepted: Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, title: `A${i}`, role: 'topic', at: '' })), rejected: [] }
    const r = formatBrief({ rules: 'Regel 1', softRange: { topic: { min: 0, median: 1, max: 2 } }, adoption: [], coverage: { ran: [], followups: [] }, precedents, negativeText: '', pairs, panel, candidateTitles: new Map([['c0', 'Kandidat']]) })
    expect(r.precedentIds).toEqual({ P1: 'u0', P2: 'u1', P3: 'u2' })
    expect(r.systemPrefix).toContain('Regel 1')
    expect(r.systemPrefix).toContain('topic')
    expect((r.dayBlock.match(/^- T\d+/gm) ?? []).length).toBe(20)
    expect((r.dayBlock.match(/^- A\d+/gm) ?? []).length).toBe(5)
  })

  it('zeigt Praezedenz-Titel ueber den synthetischen c<index>-Schluessel', () => {
    const precedents = [{ unit_id: 'u0', post_id: 'p', heading: 'H0', bundle_type: null, published_at: '2026-10-10T05:00:00.000Z', similarity: 0.9, candidate_index: 2 }]
    const r = formatBrief({ rules: '', softRange: {}, adoption: [], coverage: { ran: [], followups: [] }, precedents, negativeText: '', pairs: [], panel: { accepted: [], rejected: [] }, candidateTitles: new Map([['c2', 'Kandidat X']]) })
    expect(r.dayBlock).toContain('~ Kandidat X')
    expect(r.dayBlock).toContain('ohne Label')
  })

  it('leerer Brief: Regeln "keine", keine Tagesblock-Abschnitte', () => {
    const r = formatBrief({ rules: '', softRange: {}, adoption: [], coverage: { ran: [], followups: [] }, precedents: [], negativeText: '', pairs: [], panel: { accepted: [], rejected: [] }, candidateTitles: new Map() })
    expect(r.systemPrefix).toContain('keine')
    expect(r.dayBlock).toBe('')
    expect(r.precedentIds).toEqual({})
  })
})

describe('loadPrecedentUnits', () => {
  it('ruft die RPC mit pgvector-Strings', async () => {
    client.rpc = vi.fn(async () => ({ data: [{ unit_id: 'u', post_id: 'p', heading: 'H', bundle_type: null, published_at: 'x', similarity: 0.9, candidate_index: 1 }], error: null }))
    const r = await loadPrecedentUnits(client, [[1, 0], [0, 1]], '2026-10-15T04:25:00.000Z')
    expect(client.rpc).toHaveBeenCalledWith('get_precedent_units', { candidate_embeddings: ['[1,0]', '[0,1]'], before: '2026-10-15T04:25:00.000Z', per_role: 8 })
    expect(r[0].candidate_index).toBe(1)
  })
  it('wirft eine benannte Fehlermeldung bei RPC-Fehler', async () => {
    client.rpc = vi.fn(async () => ({ data: null, error: { message: 'kaputt' } }))
    await expect(loadPrecedentUnits(client, [[1, 0]], 'x')).rejects.toThrow('get_precedent_units: kaputt')
  })
})

describe('loadCoverageAsOf', () => {
  it('liest published_units seitenweise, embedding not null, parst den Vektor', async () => {
    state.queues.published_units = [{
      data: [{ id: 'u1', post_id: 'p1', heading: 'H', published_at: '2026-10-12T05:00:00.000Z', embedding: '[1,0]' }],
      error: null,
    }]
    const r = await loadCoverageAsOf(client, '2026-10-05T00:00:00.000Z', '2026-10-15T04:25:00.000Z')
    const q = state.chains.published_units[0]
    expect(q.gte).toHaveBeenCalledWith('published_at', '2026-10-05T00:00:00.000Z')
    expect(q.lt).toHaveBeenCalledWith('published_at', '2026-10-15T04:25:00.000Z')
    expect(q.not).toHaveBeenCalledWith('embedding', 'is', null)
    expect(r).toEqual([{ id: 'u1', post_id: 'p1', heading: 'H', published_at: '2026-10-12T05:00:00.000Z', embedding: [1, 0] }])
  })
})

describe('loadRoleSoftRange', () => {
  it('gruppiert bundle_type je post_id und speist roleSoftRange', async () => {
    state.queues.published_units = [{
      data: [{ post_id: 'p1', bundle_type: 'topic' }, { post_id: 'p1', bundle_type: 'recap' }, { post_id: 'p2', bundle_type: null }],
      error: null,
    }]
    const r = await loadRoleSoftRange(client, '2026-10-15T04:25:00.000Z')
    expect(r.topic).toEqual({ min: 0, median: 1, max: 1 })
    expect(r.recap).toEqual({ min: 0, median: 1, max: 1 })
  })
})

describe('loadCorrectionPairs', () => {
  it('ladet Runs mit reconciled_at, loest den Titel ueber das erste Member in run.pool.items auf', async () => {
    state.queues.curation_runs = [{
      data: [{ id: 'run-1', day: '2026-10-10', pool: { items: [{ id: 'item-1', title: 'Titel 1' }] } }],
      error: null,
    }]
    state.queues.curation_units = [{
      data: [{ run_id: 'run-1', member_ids: ['item-1'], role: 'topic', outcome: 'dropped_after_selection', final_role: null, matched_heading: null }],
      error: null,
    }]
    const r = await loadCorrectionPairs(client, '2026-10-15T04:25:00.000Z', 'shadow')
    expect(r).toEqual([{ outcome: 'dropped_after_selection', title: 'Titel 1', role: 'topic', final_role: null, day: '2026-10-10', heading: null }])
    expect(state.chains.curation_runs[0].eq).toHaveBeenCalledWith('mode', 'shadow')
  })
  it('ueberspringt Einheiten ohne auflösbaren Titel', async () => {
    state.queues.curation_runs = [{ data: [{ id: 'run-1', day: '2026-10-10', pool: { items: [] } }], error: null }]
    state.queues.curation_units = [{
      data: [{ run_id: 'run-1', member_ids: ['missing'], role: null, outcome: 'added', final_role: null, matched_heading: null }],
      error: null,
    }]
    const r = await loadCorrectionPairs(client, '2026-10-15T04:25:00.000Z', 'shadow')
    expect(r).toEqual([])
  })
  it('ueberspringt die curation_units-Abfrage, wenn keine Runs gefunden wurden', async () => {
    state.queues.curation_runs = [{ data: [], error: null }]
    const r = await loadCorrectionPairs(client, '2026-10-15T04:25:00.000Z', 'shadow')
    expect(r).toEqual([])
    expect(state.chains.curation_units).toBeUndefined()
  })
})

describe('loadPanelFeedback', () => {
  it('liest queue_item_events, loest Titel/Rolle ueber news_queue auf, geloeschte Items fallen weg', async () => {
    state.queues.queue_item_events = [{
      data: [
        { queue_item_id: 'a', event: 'panel_accept', at: '2026-10-14T10:00:00.000Z' },
        { queue_item_id: 'b', event: 'panel_reject', at: '2026-10-14T11:00:00.000Z' },
        { queue_item_id: 'gone', event: 'panel_accept', at: '2026-10-14T12:00:00.000Z' },
      ],
      error: null,
    }]
    state.queues.news_queue = [{
      data: [{ id: 'a', title: 'A', bundle_type: 'topic' }, { id: 'b', title: 'B', bundle_type: null }],
      error: null,
    }]
    const r = await loadPanelFeedback(client, '2026-10-15T04:25:00.000Z')
    expect(r.accepted).toEqual([{ id: 'a', title: 'A', role: 'topic', at: '2026-10-14T10:00:00.000Z' }])
    expect(r.rejected).toEqual([{ id: 'b', title: 'B', role: null, at: '2026-10-14T11:00:00.000Z' }])
  })
  it('ueberspringt die news_queue-Abfrage, wenn keine Events gefunden wurden', async () => {
    state.queues.queue_item_events = [{ data: [], error: null }]
    const r = await loadPanelFeedback(client, '2026-10-15T04:25:00.000Z')
    expect(r).toEqual({ accepted: [], rejected: [] })
    expect(state.chains.news_queue).toBeUndefined()
  })
})

describe('loadOperatorRules', () => {
  it('liest settings.curation_operator_rules.value.text', async () => {
    state.queues.settings = [{ data: { value: { text: 'Regel X' } }, error: null }]
    expect(await loadOperatorRules(client)).toBe('Regel X')
  })
  it('fehlende Zeile -> leerer String, kein Fehler', async () => {
    state.queues.settings = [{ data: null, error: null }]
    expect(await loadOperatorRules(client)).toBe('')
  })
  it('wirft bei einem DB-Fehler', async () => {
    state.queues.settings = [{ data: null, error: { message: 'nope' } }]
    await expect(loadOperatorRules(client)).rejects.toThrow('settings: nope')
  })
})

describe('loadTechmemeAdoption', () => {
  it('liest news_queue mit metadata->>techmeme = true und baut die Quote je Story-Rang', async () => {
    state.queues.news_queue = [{
      data: [{ status: 'used', metadata: { techmeme: true, techmeme_story_index: 0 } }, { status: 'expired', metadata: { techmeme: true, techmeme_story_index: 0 } }],
      error: null,
    }]
    const r = await loadTechmemeAdoption(client, '2026-10-15T04:25:00.000Z')
    expect(r).toEqual([{ index: 0, stories: 2, used: 1, rate: 0.5 }])
    expect(state.chains.news_queue[0].eq).toHaveBeenCalledWith('metadata->>techmeme', 'true')
  })
})

describe('buildArchiveBrief', () => {
  it('eine werfende Quelle landet in meta.missing, der Rest wird gebaut', async () => {
    client.rpc = vi.fn(async () => ({ data: null, error: { message: 'rpc kaputt' } }))
    state.fallback = { data: [], error: null }
    state.queues.settings = [{ data: null, error: null }]
    const brief = await buildArchiveBrief(client, { asOf: '2026-10-15T04:25:00.000Z', candidates: [{ id: 'a', title: 'A', embedding: [1, 0] }], briefMode: 'full', mode: 'shadow' })
    expect(brief.meta.missing).toContain('precedents')
    expect(brief.meta.missing).toEqual(['precedents'])
    expect(typeof brief.systemPrefix).toBe('string')
    expect(typeof brief.dayBlock).toBe('string')
  })

  it('briefMode "none" laedt nur Regeln, Soft-Range und Techmeme-Quote', async () => {
    state.fallback = { data: [], error: null }
    state.queues.settings = [{ data: null, error: null }]
    await buildArchiveBrief(client, { asOf: '2026-10-15T04:25:00.000Z', candidates: [], briefMode: 'none', mode: 'shadow' })
    // published_units wird trotzdem angefragt (Rollen-Soft-Range laeuft IMMER);
    // nur die Tagesaktuellen Quellen (Coverage/Praezedenzen/Paare/Panel) nicht.
    expect(client.rpc).not.toHaveBeenCalled()
    expect(state.chains.curation_runs).toBeUndefined()
    expect(state.chains.queue_item_events).toBeUndefined()
  })

  it('briefMode "precedents-only" laedt Coverage/Praezedenzen/Negativblock, aber keine Paare oder Panel', async () => {
    state.fallback = { data: [], error: null }
    state.queues.settings = [{ data: null, error: null }]
    client.rpc = vi.fn(async () => ({ data: [], error: null }))
    await buildArchiveBrief(client, { asOf: '2026-10-15T04:25:00.000Z', candidates: [{ id: 'a', title: 'A', embedding: [1, 0] }], briefMode: 'precedents-only', mode: 'shadow' })
    expect(state.chains.published_units).toBeDefined()
    expect(state.chains.curation_runs).toBeUndefined()
    expect(state.chains.queue_item_events).toBeUndefined()
  })
})
