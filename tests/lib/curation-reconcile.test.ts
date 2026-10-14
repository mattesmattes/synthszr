/**
 * Rekonziliation und Metriken (Task 11, lib/curation/reconcile.ts).
 * pickMatchingPost, reconcileOutcomes, metricsOf und aggregateRuns sind rein.
 * reconcileRun läuft gegen makeChain (FIFO je Tabelle, Vorlage
 * tests/lib/curation-baseline-day.test.ts); processPost, loadPoolEmbeddings
 * und die Schreib-Helfer aus service.ts sind per vi.mock gestubbt, damit die
 * Tests prüfen, WAS geschrieben wird, ohne die Service-Ketten zu wiederholen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  processPost: vi.fn(),
  loadPoolEmbeddings: vi.fn(),
  getRunUnits: vi.fn(),
  markReconciled: vi.fn(),
  updateUnitOutcomes: vi.fn(),
}))
vi.mock('@/scripts/lib/published-units-backfill', () => ({ processPost: m.processPost }))
vi.mock('@/lib/curation/pool', () => ({ loadPoolEmbeddings: m.loadPoolEmbeddings }))
vi.mock('@/lib/curation/service', async (orig) => ({
  ...(await orig() as object),
  getRunUnits: m.getRunUnits,
  markReconciled: m.markReconciled,
  updateUnitOutcomes: m.updateUnitOutcomes,
}))

import {
  aggregateRuns, loadMatchCandidates, metricsOf, pickMatchingPost, reconcileOutcomes, reconcileRun,
} from '@/lib/curation/reconcile'
import type { RunMetrics, RunRow, UnitRow } from '@/lib/curation/types'

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
  state.fallback = { data: [], error: null }
  client.from.mockClear()
  vi.clearAllMocks()
})

const ASOF = '2026-10-15T04:25:00.000Z'

describe('pickMatchingPost', () => {
  const post = (id: string, created_at: string, published_at: string | null, status = 'published') => ({ id, status, created_at, published_at })

  it('bevorzugt den manuellen Job des Tages (published_at kann durch den Backfill spaet liegen)', () => {
    const r = pickMatchingPost(ASOF, {
      jobs: [{ id: 'j', created_at: '2026-10-15T05:10:00.000Z', generated_post_id: 'p', selected_items: [], source: 'manual' }],
      posts: [post('p', '2026-10-15T05:00:00.000Z', '2026-10-20T09:00:00.000Z')],
    })
    expect(r).toEqual({ post_id: 'p', job_id: 'j', attribution: 'job' })
  })

  it('sonst fruehester Post mit published_at in (asof, asof+24h]; dann Tag von created_at; sonst null', () => {
    const byPublishedAt = pickMatchingPost(ASOF, {
      jobs: [],
      posts: [post('b', '2026-10-15T06:00:00.000Z', '2026-10-15T07:00:00.000Z'), post('a', '2026-10-15T05:00:00.000Z', '2026-10-15T06:30:00.000Z')],
    })
    expect(byPublishedAt).toMatchObject({ post_id: 'a', attribution: 'published_at' })
    const byDay = pickMatchingPost(ASOF, { jobs: [], posts: [post('c', '2026-10-15T06:00:00.000Z', '2026-10-18T07:00:00.000Z')] })
    expect(byDay).toMatchObject({ post_id: 'c', attribution: 'created_at_day' })
    const none = pickMatchingPost(ASOF, { jobs: [], posts: [post('d', '2026-10-16T06:00:00.000Z', '2026-10-16T07:00:00.000Z')] })
    expect(none).toBeNull()
    const autoJob = pickMatchingPost(ASOF, {
      jobs: [{ id: 'auto', created_at: '2026-10-15T05:00:00.000Z', generated_post_id: 'x', selected_items: [], source: 'auto' }],
      posts: [post('x', '2026-10-15T05:00:00.000Z', '2026-10-15T05:30:00.000Z')],
    })
    expect(autoJob).toMatchObject({ attribution: 'published_at' })
  })

  it('Job ausserhalb [asof − 2 h, asof + 24 h] oder mit unveroeffentlichtem Post zaehlt nicht', () => {
    const early = { id: 'early', created_at: '2026-10-15T02:24:59.000Z', generated_post_id: 'p', selected_items: [], source: 'manual' }
    const draft = { id: 'draft', created_at: '2026-10-15T05:00:00.000Z', generated_post_id: 'q', selected_items: [], source: 'manual' }
    const r = pickMatchingPost(ASOF, {
      jobs: [early, draft],
      posts: [post('p', '2026-10-15T05:00:00.000Z', null), post('q', '2026-10-15T05:00:00.000Z', null, 'draft')],
    })
    expect(r).toMatchObject({ post_id: 'p', job_id: null, attribution: 'created_at_day' })
  })
})

const unit = (p: Partial<UnitRow> & { unit_key: string; member_ids: string[]; tier: UnitRow['tier'] }): UnitRow => ({
  id: p.unit_key, run_id: 'r', story_key: p.member_ids[0], role: null, rank: 1, reason: null, alternative: null, precedent_ids: [],
  is_hand: false, panel_action: null, panel_at: null, outcome: null, final_role: null, final_rank: null, matched_post_id: null,
  matched_heading: null, similarity: null, created_at: '', ...p,
})
const pub = (id: string, member_ids: string[], bundle_type: string | null = null, embedding: number[] | null = null, position = 0) => ({
  id, position, heading: `H ${id}`, bundle_type, member_ids, embedding,
})

describe('reconcileOutcomes', () => {
  it('ID-Treffer kept/relabeled, Similarity merged, dropped_after_selection vs never, added', () => {
    const units = [
      unit({ unit_key: 'topic::a', member_ids: ['a'], tier: 'recommended', role: 'topic' }),
      unit({ unit_key: 'single::b', member_ids: ['b'], tier: 'recommended', rank: 2 }),
      unit({ unit_key: 'single::c', member_ids: ['c'], tier: 'bench' }),
      unit({ unit_key: 'single::d', member_ids: ['d'], tier: 'bench', rank: 2 }),
      unit({ unit_key: 'single::e', member_ids: ['e'], tier: 'held', is_hand: true }),
    ]
    const published = [
      pub('u1', ['a'], 'topic', [1, 0, 0], 0),
      pub('u2', ['b'], 'recap', [0, 1, 0], 1),
      pub('u3', [], null, [0, 0, 1], 2),
      pub('u4', ['zz'], null, [0.5, 0.5, 0.7], 3),
    ]
    const emb = new Map([['c', [0, 0, 1]], ['d', [1, 1, 0]]])
    const r = reconcileOutcomes(units, published, emb, new Set(['d', 'e']), 'post', 0.8)
    const by = Object.fromEntries(r.outcomes.map(o => [o.unit_key, o]))
    expect(by['topic::a']).toMatchObject({ outcome: 'kept', final_role: 'topic', final_rank: 1 })
    expect(by['single::b']).toMatchObject({ outcome: 'relabeled', final_role: 'recap' })
    expect(by['single::c']).toMatchObject({ outcome: 'merged', matched_heading: 'H u3' })
    expect(by['single::d'].outcome).toBe('dropped_after_selection')
    expect(by['single::e'].outcome).toBe('dropped_after_selection')
    expect(r.added.map(a => a.id)).toEqual(['u4'])
  })

  it('Reihenfolge recommended → bench → held, Felder je Treffer, matched-Map, dropped_never_selected', () => {
    const units = [
      unit({ unit_key: 'held::h', member_ids: ['h'], tier: 'held', is_hand: true }),
      unit({ unit_key: 'bench::n', member_ids: ['n'], tier: 'bench' }),
      unit({ unit_key: 'rec::2', member_ids: ['r2'], tier: 'recommended', rank: 2 }),
      unit({ unit_key: 'rec::1', member_ids: ['r1'], tier: 'recommended', rank: 1 }),
    ]
    const published = [pub('u1', ['r1'], null, null, 0), pub('u2', ['x', 'r2'], 'deep_dive', null, 1)]
    const r = reconcileOutcomes(units, published, new Map(), new Set(), 'post')
    expect(r.outcomes.map(o => o.unit_key)).toEqual(['rec::1', 'rec::2', 'bench::n', 'held::h'])
    expect(r.outcomes[0]).toEqual({
      unit_key: 'rec::1', outcome: 'kept', final_role: null, final_rank: 1, matched_post_id: 'post', matched_heading: 'H u1', similarity: 1,
    })
    expect(r.outcomes[1]).toMatchObject({ outcome: 'relabeled', final_role: 'deep_dive', final_rank: 2, matched_heading: 'H u2' })
    expect(r.outcomes[2]).toEqual({
      unit_key: 'bench::n', outcome: 'dropped_never_selected', final_role: null, final_rank: null, matched_post_id: null, matched_heading: null, similarity: null,
    })
    expect(r.matched).toEqual(new Map([['rec::1', 'u1'], ['rec::2', 'u2']]))
    expect(r.added).toEqual([])
  })

  it('zwei Plan-Einheiten im selben Abschnitt sind beide Treffer — keine gilt als gestrichen', () => {
    const units = [
      unit({ unit_key: 'single::a', member_ids: ['a'], tier: 'recommended' }),
      unit({ unit_key: 'single::b', member_ids: ['b'], tier: 'recommended', rank: 2 }),
    ]
    const r = reconcileOutcomes(units, [pub('u1', ['a', 'b'], 'deep_dive')], new Map(), new Set(['a', 'b']), 'post')
    expect(r.outcomes.map(o => o.outcome)).toEqual(['relabeled', 'relabeled'])
    expect(r.added).toEqual([])
  })

  it('Similarity: Maximum ueber die Member, auf 3 Stellen gerundet; ID-getroffene Abschnitte und kaputte Vektoren zaehlen nicht', () => {
    const units = [
      unit({ unit_key: 'single::a', member_ids: ['a'], tier: 'recommended' }),
      unit({ unit_key: 'bundle::cd', member_ids: ['c', 'd'], tier: 'bench' }),
    ]
    const published = [pub('u1', ['a'], null, [0, 0, 1], 0), pub('u2', [], null, [1, 0.3, 0], 1), pub('u3', [], null, [1, 2], 2)]
    const emb = new Map([['c', [0, 0, 1]], ['d', [1, 0.5, 0]]])
    const r = reconcileOutcomes(units, published, emb, new Set(), 'post')
    const merged = r.outcomes.find(o => o.unit_key === 'bundle::cd')
    expect(merged).toMatchObject({ outcome: 'merged', matched_heading: 'H u2', final_rank: 2, similarity: 0.985 })
    expect(r.added.map(a => a.id)).toEqual(['u3'])
  })
})

describe('metricsOf', () => {
  it('Unit-Recall@20 auf Story-Ebene, Setzlisten-Precision, cut_rate, additions, held_rate', () => {
    const units = [
      unit({ unit_key: 'single::a', member_ids: ['a'], tier: 'recommended' }),
      unit({ unit_key: 'single::b', member_ids: ['b'], tier: 'recommended', rank: 2 }),
      unit({ unit_key: 'single::c', member_ids: ['c'], tier: 'bench' }),
      unit({ unit_key: 'single::h', member_ids: ['h'], tier: 'held', is_hand: true }),
    ]
    const published = [pub('u1', ['a']), pub('u2', ['c']), pub('u3', ['x'])]
    const outcomes = [
      { unit_key: 'single::a', outcome: 'kept' as const, final_role: null, final_rank: 1, matched_post_id: 'p', matched_heading: 'H u1', similarity: 1 },
      { unit_key: 'single::b', outcome: 'dropped_after_selection' as const, final_role: null, final_rank: null, matched_post_id: null, matched_heading: null, similarity: null },
      { unit_key: 'single::c', outcome: 'kept' as const, final_role: null, final_rank: 2, matched_post_id: 'p', matched_heading: 'H u2', similarity: 1 },
      { unit_key: 'single::h', outcome: 'dropped_after_selection' as const, final_role: null, final_rank: null, matched_post_id: null, matched_heading: null, similarity: null },
    ]
    const snapshot = {
      asOf: ASOF, windowFrom: '',
      items: ['a', 'b', 'c', 'h', 'x'].map(id => ({
        id, title: id, source_identifier: 'q', source_display_name: null, total_score: 1, bundle_type: null, metadata: null, content_length: 1000,
        daily_repo_id: null, queued_at: '', source_pub_rate: 0, excerpt: '', hand: id === 'h', techmeme_story: null, techmeme_story_index: null,
      })),
      truncated: false, excluded: { used_earlier: 0, expired: 0, skipped: 0, junk: 0, short: 0 }, handIds: ['h'], techmemeStories: [],
    }
    const cluster = { storyKeyOf: { a: 'a', b: 'b', c: 'c', h: 'h', x: 'x' }, clusters: {}, related: [] }
    const m = metricsOf({
      units, outcomes, published, added: [published[2]], baseline: { total_score: { '10': ['x', 'a'], '20': ['x', 'a'] } },
      snapshot, cluster, itemEmbeddings: new Map(), attribution: 'job',
    })
    expect(m.unit_recall_20).toBeCloseTo(2 / 3)
    expect(m.setzlisten_recall_10).toBeCloseTo(1 / 3)
    expect(m.setzlisten_precision_10).toBeCloseTo(0.5)
    expect(m.cut_rate).toBeCloseTo(0.5)
    expect(m.additions).toBe(1)
    expect(m.additions_rate).toBeCloseTo(1 / 3)
    expect(m.held_rate).toBe(1)
    expect(m.baseline_total_score_unit_recall_20).toBeCloseTo(2 / 3)
    expect(m.diff_vs_total_score_20).toBeCloseTo(0)
    expect(m.outcomes.kept).toBe(2)
  })
})

describe('aggregateRuns', () => {
  it('mittelt nur attribuierte Tage; Gate-Felder', () => {
    const mk = (u: number, b: number): RunMetrics => ({
      attribution: 'job', published_units: 9, published_attributable: 9, plan: { recommended: 10, bench: 10, held: 0 },
      unit_recall_20: u, unit_recall_id_20: u, setzlisten_recall_10: 0.4, setzlisten_precision_10: 0.5, duplicate_rate_recommended: 0,
      cut_rate: 0.3, additions: 1, additions_rate: 0.1, hand_stories: 2, held_rate: 0, baseline_total_score_unit_recall_20: b,
      baseline_total_score_recall_10: 0.2, diff_vs_total_score_20: u - b,
      outcomes: { kept: 0, relabeled: 0, merged: 0, dropped_after_selection: 0, dropped_never_selected: 0, added: 0 },
    })
    const list = [...Array.from({ length: 6 }, () => mk(0.6, 0.4)), { ...mk(0, 0), attribution: 'none' as const }]
    const a = aggregateRuns(list, 0.42)
    expect(a.n).toBe(6)
    expect(a.mean.unit_recall_20).toBeCloseTo(0.6)
    expect(a.diff_vs_total_score_20.mean).toBeCloseTo(0.2)
    expect(a.gate.floor).toBe(true)
    expect(a.gate.duplicates_zero).toBe(true)
    expect(a.gate.precision_vs_hand).toBe(true)
  })
})

// ── reconcileRun ──────────────────────────────────────────────────────────

const poolItem = (id: string) => ({
  id, title: id, source_identifier: 'q', source_display_name: null, total_score: 1, bundle_type: null, metadata: null, content_length: 1000,
  daily_repo_id: null, queued_at: '', source_pub_rate: 0, excerpt: '', hand: false, techmeme_story: null, techmeme_story_index: null,
})
const RUN: RunRow = {
  id: 'r', day: '2026-10-15', mode: 'shadow', asof: ASOF, status: 'done', phase: 'finished', brief_mode: 'full', attempts: 3,
  last_advanced_at: null, cancel_requested: false, log: [], degraded: [], budget_usd: 4, spend_usd: 1, compose_attempts: 1,
  pool: {
    asOf: ASOF, windowFrom: '', items: ['a', 'b', 'x'].map(poolItem), truncated: false,
    excluded: { used_earlier: 0, expired: 0, skipped: 0, junk: 0, short: 0 }, handIds: [], techmemeStories: [],
  },
  cards: null, story_keys: null, brief: null, baseline: { total_score: { '10': ['x'], '20': ['x'] } }, plan: null, critique: null,
  reconciled_at: null, matched_post_id: null, matched_job_id: null, metrics: null, model_scout: 'h', model_editor: 'o', model_critic: 's',
  error_message: null, created_at: '', finished_at: null,
}
const embed = vi.fn()
const POST_ROW = { id: 'p', content: '{"type":"doc","content":[]}', published_at: '2026-10-20T09:00:00.000Z' }

/** FIFO-Antworten fuer einen Lauf mit Job-Treffer auf Post 'p'. */
function queueMatchedDay() {
  state.queues.article_jobs = [
    { data: [{ id: 'j', created_at: '2026-10-15T05:10:00.000Z', generated_post_id: 'p', source: 'manual' }], error: null },
    { data: { selected_items: [{ id: 'a' }, { id: 'b', bundle_type: null }] }, error: null },
  ]
  state.queues.generated_posts = [
    { data: [{ id: 'p', status: 'published', created_at: '2026-10-15T05:00:00.000Z', published_at: '2026-10-20T09:00:00.000Z' }], error: null },
    { data: [], error: null },
    { data: POST_ROW, error: null },
  ]
  state.queues.published_units = [{
    data: [
      { id: 'u1', position: 0, heading: 'H1', bundle_type: null, member_ids: ['a'], embedding: '[1,0]' },
      { id: 'u2', position: 1, heading: 'H2', bundle_type: 'topic', member_ids: ['x'], embedding: null },
    ],
    error: null,
  }]
  m.processPost.mockResolvedValue({ kind: 'written', units: [], embedded: 1 })
  m.loadPoolEmbeddings.mockResolvedValue({ embeddings: new Map(), generated: 0, failed: 0 })
  m.getRunUnits.mockResolvedValue([
    unit({ unit_key: 'single::a', member_ids: ['a'], tier: 'recommended' }),
    unit({ unit_key: 'single::b', member_ids: ['b'], tier: 'recommended', rank: 2 }),
  ])
}

describe('loadMatchCandidates', () => {
  it('Jobs in [asof − 2 h, asof + 24 h], Posts published per created_at ± 36 h ODER published_at in (asof, asof + 24 h], dedupliziert', async () => {
    const row = { id: 'p', status: 'published', created_at: '2026-10-15T05:00:00.000Z', published_at: '2026-10-15T06:00:00.000Z' }
    state.queues.article_jobs = [{ data: [{ id: 'j', created_at: '2026-10-15T05:10:00.000Z', generated_post_id: 'p', source: 'manual' }], error: null }]
    state.queues.generated_posts = [{ data: [row], error: null }, { data: [row], error: null }]
    const c = await loadMatchCandidates(client, ASOF)
    expect(c.jobs).toEqual([{ id: 'j', created_at: '2026-10-15T05:10:00.000Z', generated_post_id: 'p', source: 'manual', selected_items: null }])
    expect(c.posts).toEqual([row])
    const jobs = state.chains.article_jobs[0]
    expect(jobs.select).toHaveBeenCalledWith('id, created_at, generated_post_id, source')
    expect(jobs.gte).toHaveBeenCalledWith('created_at', '2026-10-15T02:25:00.000Z')
    expect(jobs.lte).toHaveBeenCalledWith('created_at', '2026-10-16T04:25:00.000Z')
    const [byCreated, byPublished] = state.chains.generated_posts
    expect(byCreated.eq).toHaveBeenCalledWith('status', 'published')
    expect(byCreated.gte).toHaveBeenCalledWith('created_at', '2026-10-13T16:25:00.000Z')
    expect(byCreated.lte).toHaveBeenCalledWith('created_at', '2026-10-16T16:25:00.000Z')
    expect(byPublished.eq).toHaveBeenCalledWith('status', 'published')
    expect(byPublished.gt).toHaveBeenCalledWith('published_at', ASOF)
    expect(byPublished.lte).toHaveBeenCalledWith('published_at', '2026-10-16T04:25:00.000Z')
  })
})

describe('reconcileRun', () => {
  it('ohne Post: markReconciled mit null und attribution none, keine Outcomes, published_units unberuehrt', async () => {
    const r = await reconcileRun(client, RUN, embed)
    expect(r.matched).toBeNull()
    expect(r.metrics).toMatchObject({ attribution: 'none', unit_recall_20: 0, published_units: 0, diff_vs_total_score_20: null })
    expect(m.markReconciled).toHaveBeenCalledWith(client, 'r', { matched_post_id: null, matched_job_id: null, metrics: r.metrics })
    expect(m.updateUnitOutcomes).not.toHaveBeenCalled()
    expect(m.processPost).not.toHaveBeenCalled()
    expect(m.getRunUnits).not.toHaveBeenCalled()
  })

  it('mit Job-Treffer: published_units nachgepflegt, Outcomes + added geschrieben, Metriken am Run', async () => {
    queueMatchedDay()
    const r = await reconcileRun(client, RUN, embed)
    expect(r.matched).toEqual({ post_id: 'p', job_id: 'j', attribution: 'job' })
    expect(m.processPost).toHaveBeenCalledWith(client, embed, POST_ROW, false)
    expect(state.chains.generated_posts[2].eq).toHaveBeenCalledWith('id', 'p')
    expect(state.chains.published_units[0].eq).toHaveBeenCalledWith('post_id', 'p')
    expect(state.chains.published_units[0].order).toHaveBeenCalledWith('position')
    expect(state.chains.article_jobs[1].select).toHaveBeenCalledWith('selected_items')
    expect(state.chains.article_jobs[1].eq).toHaveBeenCalledWith('id', 'j')
    expect(m.loadPoolEmbeddings).toHaveBeenCalledWith(client, RUN.pool!.items, embed)
    expect(m.updateUnitOutcomes).toHaveBeenCalledWith(
      client,
      'r',
      [
        { unit_key: 'single::a', outcome: 'kept', final_role: null, final_rank: 1, matched_post_id: 'p', matched_heading: 'H1', similarity: 1 },
        { unit_key: 'single::b', outcome: 'dropped_after_selection', final_role: null, final_rank: null, matched_post_id: null, matched_heading: null, similarity: null },
      ],
      [{
        unit_key: 'added::p::1', member_ids: ['x'], story_key: null, role: 'topic', rank: null, tier: null, reason: null, alternative: null,
        precedent_ids: [], is_hand: false, panel_action: null, panel_at: null, outcome: 'added', final_role: 'topic', final_rank: 2,
        matched_post_id: 'p', matched_heading: 'H2', similarity: null,
      }],
    )
    expect(r.metrics).toMatchObject({
      attribution: 'job', published_units: 2, published_attributable: 2, unit_recall_20: 0.5, cut_rate: 0.5, additions: 1,
      baseline_total_score_unit_recall_20: 0.5, diff_vs_total_score_20: 0,
    })
    expect(m.markReconciled).toHaveBeenCalledWith(client, 'r', { matched_post_id: 'p', matched_job_id: 'j', metrics: r.metrics })
  })

  it('Retry nach Teil-Schreiben: vorhandene added-Zeilen sind keine Plan-Einheiten und werden nicht erneut eingefuegt', async () => {
    queueMatchedDay()
    m.getRunUnits.mockResolvedValue([
      unit({ unit_key: 'single::a', member_ids: ['a'], tier: 'recommended' }),
      unit({ unit_key: 'added::p::1', member_ids: ['x'], tier: null, rank: null, outcome: 'added' }),
    ])
    await reconcileRun(client, RUN, embed)
    const [, , outcomes, added] = m.updateUnitOutcomes.mock.calls[0]
    expect(outcomes.map((o: { unit_key: string }) => o.unit_key)).toEqual(['single::a'])
    expect(added).toEqual([])
  })

  it('Embedding-Fehler beim Nachpflegen wirft — kein Abgleich gegen einen veralteten Stand', async () => {
    queueMatchedDay()
    m.processPost.mockResolvedValue({ kind: 'embed_failed', units: [], error: 'gemini down' })
    await expect(reconcileRun(client, RUN, embed)).rejects.toThrow('gemini down')
    expect(m.updateUnitOutcomes).not.toHaveBeenCalled()
    expect(m.markReconciled).not.toHaveBeenCalled()
  })
})
