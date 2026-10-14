/**
 * Phasenmaschine (Task 10, lib/curation/run.ts). Alle Phasen-Module sind per
 * vi.mock gestubbt, damit die Maschine isoliert testbar ist. Echt laufen nur
 * run.ts selbst, totalScoreListsByK (baseline-day.ts) und estimateUsd
 * (lib/ai/call.ts) — die Budget-Tests rechnen bewusst mit dessen
 * Fallback-Preis {input 5, output 25} USD je Mio. Tokens, weil die
 * Testmodelle 'h'/'o'/'s' nicht in MODEL_PRICING stehen: compose (24 000
 * Output-Tokens) ≈ 0,60 USD, Kritiker (4 096 Output-Tokens) ≈ 0,10 USD.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  loadPoolAsOf: vi.fn(), loadPoolEmbeddings: vi.fn(), clusterPool: vi.fn(), scoutBatch: vi.fn(), loadCachedCards: vi.fn(), saveCards: vi.fn(),
  buildArchiveBrief: vi.fn(), composeDay: vi.fn(), baselinePlan: vi.fn(), checkHardRules: vi.fn(), checkSoftRules: vi.fn(), critiqueWithModel: vi.fn(),
  saveRunState: vi.fn(), appendRunLog: vi.fn(), finishRun: vi.fn(), insertUnits: vi.fn(), getRun: vi.fn(),
}))
vi.mock('@/lib/curation/pool', () => ({ loadPoolAsOf: m.loadPoolAsOf, loadPoolEmbeddings: m.loadPoolEmbeddings }))
vi.mock('@/lib/curation/cluster', () => ({ clusterPool: m.clusterPool, handStoriesOf: () => ({}), leaderOf: (c: any, k: string) => k }))
vi.mock('@/lib/curation/scout', () => ({ scoutBatch: m.scoutBatch, loadCachedCards: m.loadCachedCards, saveCards: m.saveCards, fallbackCard: (i: any) => ({ id: i.id, core: i.title }), batchesOf: (a: any[], n: number) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o } }))
vi.mock('@/lib/curation/archive', () => ({ buildArchiveBrief: m.buildArchiveBrief }))
vi.mock('@/lib/curation/compose', () => ({ composeDay: m.composeDay, baselinePlan: m.baselinePlan, buildComposeMessages: () => ({ cachedPrefix: 'p', system: 's', user: 'u' }) }))
vi.mock('@/lib/curation/critic', () => ({ checkHardRules: m.checkHardRules, checkSoftRules: m.checkSoftRules, critiqueWithModel: m.critiqueWithModel, revisionHints: (h: string[]) => h }))
vi.mock('@/lib/curation/service', async (orig) => ({ ...(await orig() as object), saveRunState: m.saveRunState, appendRunLog: m.appendRunLog, finishRun: m.finishRun, insertUnits: m.insertUnits, getRun: m.getRun }))
import {
  advanceRun, phaseArchive, phaseCluster, phaseCompose, phaseScout, reserveBudget, runDayInline, unitsFromPlan, POOL_MIN_ITEMS,
} from '@/lib/curation/run'
import { DEFAULT_CURATION_SETTINGS } from '@/lib/curation/types'
import type { ComposeUnit, RunRow } from '@/lib/curation/types'

const items = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `i${i}`, title: `T${i}`, source_identifier: 'q', source_display_name: null, total_score: n - i, bundle_type: null, metadata: null,
  content_length: 1000, daily_repo_id: null, queued_at: '', source_pub_rate: 0, excerpt: '', hand: false, techmeme_story: null, techmeme_story_index: null,
}))
const snap = (n: number) => ({
  asOf: '2026-10-15T04:25:00.000Z', windowFrom: '', items: items(n), truncated: false,
  excluded: { used_earlier: 0, expired: 0, skipped: 0, junk: 0, short: 0 }, handIds: [] as string[],
  techmemeStories: [] as Array<{ story: string; index: number; member_ids: string[] }>,
})
const run = (over: Partial<RunRow> = {}): RunRow => ({
  id: 'r', day: '2026-10-15', mode: 'shadow', asof: '2026-10-15T04:25:00.000Z', status: 'processing', phase: 'pool', brief_mode: 'full',
  attempts: 1, last_advanced_at: null, cancel_requested: false, log: [], degraded: [], budget_usd: 4, spend_usd: 0, compose_attempts: 0,
  pool: null, cards: null, story_keys: null, brief: null, baseline: null, plan: null, critique: null, reconciled_at: null,
  matched_post_id: null, matched_job_id: null, metrics: null, model_scout: 'h', model_editor: 'o', model_critic: 's',
  error_message: null, created_at: '', finished_at: null, ...over,
})
const deps = (over: Partial<any> = {}) => ({
  supabase: {} as any, callTool: vi.fn(), embed: vi.fn(), settings: DEFAULT_CURATION_SETTINGS,
  models: { scout: 'h', editor: 'o', critic: 's' }, now: () => 0, budgetMs: 600_000, ...over,
})
const plan = (src: 'model' | 'baseline' = 'model') => ({ thesis: '', units: [] as ComposeUnit[], techmeme_decisions: [], hand_story_decisions: [], fixes: [], source: src })
const unit: ComposeUnit = {
  unit_key: 'topic::i0', member_ids: ['i0'], story_key: 'i0', role: 'topic', rank: 1, tier: 'recommended',
  reason: 'r', alternative: null, precedent_ids: [], is_hand: false,
}
const emptyCluster = () => ({ storyKeyOf: {}, clusters: {}, related: [] })
const emptyBrief = (missing: string[] = []) => ({ systemPrefix: '', dayBlock: '', precedentIds: {}, meta: { missing } })

/** Alle Phasen-Stubs fuer einen Lauf, der ohne Degradierung bis 'finished' durchlaeuft. */
function mockHappyRun() {
  m.loadPoolAsOf.mockResolvedValue(snap(POOL_MIN_ITEMS))
  m.loadCachedCards.mockResolvedValue(new Map())
  m.scoutBatch.mockImplementation(async (_call: unknown, batch: Array<{ id: string }>) => ({
    cards: batch.map((i) => ({ id: i.id, core: 'k' })), missing: [], costUsd: 0.01,
  }))
  m.clusterPool.mockReturnValue(emptyCluster())
  m.buildArchiveBrief.mockResolvedValue(emptyBrief())
  m.composeDay.mockResolvedValue({ plan: { ...plan(), units: [unit] }, costUsd: 0.5, model: 'o' })
  m.checkHardRules.mockReturnValue([])
  m.critiqueWithModel.mockResolvedValue({ hard: [], soft: [], costUsd: 0.05 })
}

beforeEach(() => {
  vi.clearAllMocks()
  m.saveRunState.mockResolvedValue(undefined)
  m.appendRunLog.mockResolvedValue(undefined)
  m.finishRun.mockResolvedValue(undefined)
  m.insertUnits.mockResolvedValue(undefined)
  m.saveCards.mockResolvedValue(undefined)
  m.checkSoftRules.mockReturnValue([])
  m.baselinePlan.mockReturnValue(plan('baseline'))
  // Ruling R1: phaseArchive/phaseCompose laden Embeddings neu — ohne Default waere das Ergebnis undefined.
  m.loadPoolEmbeddings.mockResolvedValue({ embeddings: new Map(), generated: 0, failed: 0 })
})

describe('advanceRun', () => {
  it('Pool unter 40 → error pool_small, kein Modellaufruf, keine Einheiten', async () => {
    m.loadPoolAsOf.mockResolvedValue(snap(12))
    const d = deps()
    const r = await advanceRun(d, run())
    expect(r.finished).toBe(true)
    expect(m.finishRun).toHaveBeenCalledWith(d.supabase, 'r', 'error', 'pool_small:12')
    expect(d.callTool).not.toHaveBeenCalled()
    expect(m.insertUnits).not.toHaveBeenCalled()
  })

  it('vor compose mit < 420 s Restbudget endet der Tick ohne Call', async () => {
    let t = 0
    const d = deps({ now: () => t, budgetMs: 600_000 })
    m.loadPoolAsOf.mockResolvedValue(snap(POOL_MIN_ITEMS))
    m.loadCachedCards.mockResolvedValue(new Map())
    m.scoutBatch.mockImplementation(async () => {
      t += 200_000
      return { cards: [], missing: [], costUsd: 0.1 }
    })
    m.loadPoolEmbeddings.mockResolvedValue({ embeddings: new Map(), generated: 0, failed: 0 })
    m.clusterPool.mockReturnValue(emptyCluster())
    m.buildArchiveBrief.mockResolvedValue(emptyBrief())
    const r = await advanceRun(d, run())
    expect(r.phase).toBe('compose')
    expect(r.finished).toBe(false)
    expect(m.composeDay).not.toHaveBeenCalled()
  })

  it('arbeitet alle Phasen ab: je Phase saveRunState + appendRunLog, Baseline aus dem Snapshot, Einheiten, finishRun done', async () => {
    mockHappyRun()
    const d = deps()
    const r = await advanceRun(d, run())
    expect(r).toEqual({ phase: 'finished', finished: true, note: 'done' })
    const phasePatches = m.saveRunState.mock.calls.map((c) => c[2]).filter((p) => 'phase' in p)
    expect(phasePatches.map((p) => p.phase)).toEqual(['scout', 'cluster', 'archive', 'compose', 'units', 'finished'])
    expect(phasePatches[0].baseline.total_score['10']).toHaveLength(10)
    expect(phasePatches[0].baseline.total_score['20']).toHaveLength(20)
    expect(m.appendRunLog).toHaveBeenCalledTimes(6)
    expect(m.insertUnits).toHaveBeenCalledWith(d.supabase, 'r', [expect.objectContaining({ unit_key: 'topic::i0', outcome: null })])
    expect(m.finishRun).toHaveBeenCalledWith(d.supabase, 'r', 'done')
  })

  it('andere Fehler werden geworfen, der Run bleibt offen (Route zaehlt attempts)', async () => {
    m.loadPoolAsOf.mockRejectedValueOnce(new Error('news_queue: timeout'))
    await expect(advanceRun(deps(), run())).rejects.toThrow('news_queue: timeout')
    expect(m.finishRun).not.toHaveBeenCalled()
  })

  it('Run steht schon auf finished → nur finishRun done', async () => {
    const d = deps()
    const r = await advanceRun(d, run({ phase: 'finished' }))
    expect(r.finished).toBe(true)
    expect(m.saveRunState).not.toHaveBeenCalled()
    expect(m.finishRun).toHaveBeenCalledWith(d.supabase, 'r', 'done')
  })
})

describe('phaseScout', () => {
  it('Cache zuerst, saveCards je Batch mit Cards, Fallback fuer Fehlende, scout_partial ueber 10 %', async () => {
    m.loadCachedCards.mockResolvedValue(new Map([['i0', 'gecacht']]))
    m.scoutBatch.mockImplementation(async (_call: unknown, batch: Array<{ id: string }>) => {
      if (batch[0].id === 'i1') return { cards: [{ id: 'i1', core: 'k1' }, { id: 'i2', core: 'k2' }], missing: [], costUsd: 0.01 }
      return { cards: [], missing: batch.map((i) => i.id), costUsd: 0.02 }
    })
    const d = deps({ settings: { ...DEFAULT_CURATION_SETTINGS, scout_batch_size: 2 } })
    const patch = await phaseScout(d, run({ phase: 'scout', pool: snap(5), spend_usd: 1 }))
    expect(m.loadCachedCards).toHaveBeenCalledWith(d.supabase, ['i0', 'i1', 'i2', 'i3', 'i4'], 'h')
    expect(m.scoutBatch.mock.calls.map((c) => c[1].map((i: { id: string }) => i.id))).toEqual([['i1', 'i2'], ['i3', 'i4']])
    expect(m.saveCards).toHaveBeenCalledTimes(1)
    expect(m.saveCards).toHaveBeenCalledWith(d.supabase, [{ id: 'i1', core: 'k1' }, { id: 'i2', core: 'k2' }], 'h')
    expect(patch.cards).toEqual([
      { id: 'i0', core: 'gecacht' }, { id: 'i1', core: 'k1' }, { id: 'i2', core: 'k2' }, { id: 'i3', core: 'T3' }, { id: 'i4', core: 'T4' },
    ])
    expect(patch.spend_usd).toBeCloseTo(1.03)
    expect(patch.degraded).toEqual(['scout_partial'])
    expect(patch.phase).toBe('cluster')
  })

  it('genau 10 % ohne Card → kein scout_partial', async () => {
    m.loadCachedCards.mockResolvedValue(new Map(items(18).map((i) => [i.id, 'c'] as [string, string])))
    m.scoutBatch.mockResolvedValue({ cards: [], missing: ['i18', 'i19'], costUsd: 0 })
    const patch = await phaseScout(deps(), run({ phase: 'scout', pool: snap(20) }))
    expect(patch.cards).toHaveLength(20)
    expect(patch.degraded).toEqual([])
  })

  it('hoechstens 4 Batches gleichzeitig', async () => {
    let active = 0
    let peak = 0
    m.loadCachedCards.mockResolvedValue(new Map())
    m.scoutBatch.mockImplementation(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 0))
      active--
      return { cards: [], missing: [], costUsd: 0 }
    })
    await phaseScout(deps({ settings: { ...DEFAULT_CURATION_SETTINGS, scout_batch_size: 1 } }), run({ phase: 'scout', pool: snap(6) }))
    expect(m.scoutBatch).toHaveBeenCalledTimes(6)
    expect(peak).toBe(4)
  })

  it('Budget reicht nicht → kein Scout-Call, Fallback-Cards, budget + scout_partial', async () => {
    m.loadCachedCards.mockResolvedValue(new Map())
    const patch = await phaseScout(deps(), run({ phase: 'scout', pool: snap(3), spend_usd: 3.95 }))
    expect(m.scoutBatch).not.toHaveBeenCalled()
    expect(patch.cards).toEqual([{ id: 'i0', core: 'T0' }, { id: 'i1', core: 'T1' }, { id: 'i2', core: 'T2' }])
    expect(patch.degraded).toEqual(['budget', 'scout_partial'])
    expect(patch.spend_usd).toBe(3.95)
  })
})

describe('phaseCluster', () => {
  it('Embeddings → clusterPool; failed > 0 → pool_embeddings', async () => {
    const embeddings = new Map([['i0', [1, 0]]])
    const result = { storyKeyOf: { i0: 'i0' }, clusters: { i0: ['i0'] }, related: [] }
    m.loadPoolEmbeddings.mockResolvedValue({ embeddings, generated: 1, failed: 2 })
    m.clusterPool.mockReturnValue(result)
    const pool = snap(3)
    const d = deps()
    const patch = await phaseCluster(d, run({ phase: 'cluster', pool }))
    expect(m.loadPoolEmbeddings).toHaveBeenCalledWith(d.supabase, pool.items, d.embed)
    expect(m.clusterPool).toHaveBeenCalledWith(pool, embeddings)
    expect(patch.story_keys).toBe(result)
    expect(patch.degraded).toEqual(['pool_embeddings'])
    expect(patch.phase).toBe('archive')
  })

  it('ohne Embedding-Fehler keine Degradierung', async () => {
    m.clusterPool.mockReturnValue(emptyCluster())
    const patch = await phaseCluster(deps(), run({ phase: 'cluster', pool: snap(3) }))
    expect(patch.degraded).toEqual([])
  })
})

describe('phaseArchive', () => {
  it('Kandidaten: Hand → Techmeme-Anfuehrer → Anfuehrer der Top-80, nur mit Embedding, ohne Dubletten', async () => {
    const pool = { ...snap(100), handIds: ['i99'], techmemeStories: [{ story: 'x', index: 0, member_ids: ['i97', 'i98'] }] }
    // leaderOf ist gestubbt (liefert den Key) — Anfuehrer = story_key. i6 haengt an i5, i97 an i98.
    const storyKeyOf: Record<string, string> = { i6: 'i5', i97: 'i98' }
    const embeddings = new Map(pool.items.filter((i) => i.id !== 'i3').map((i) => [i.id, [1]]))
    m.loadPoolEmbeddings.mockResolvedValue({ embeddings, generated: 0, failed: 0 })
    m.buildArchiveBrief.mockResolvedValue(emptyBrief(['coverage']))
    const d = deps()
    const patch = await phaseArchive(d, run({
      phase: 'archive', pool, brief_mode: 'precedents-only', story_keys: { storyKeyOf, clusters: {}, related: [] },
    }))
    const input = m.buildArchiveBrief.mock.calls[0][1]
    const ids = input.candidates.map((c: { id: string }) => c.id)
    expect(m.buildArchiveBrief.mock.calls[0][0]).toBe(d.supabase)
    expect(input).toMatchObject({ asOf: '2026-10-15T04:25:00.000Z', briefMode: 'precedents-only', mode: 'shadow' })
    expect(input.candidates[0]).toEqual({ id: 'i99', title: 'T99', embedding: [1] })
    expect(ids.slice(0, 3)).toEqual(['i99', 'i98', 'i0'])
    expect(ids).not.toContain('i3')
    expect(ids).not.toContain('i6')
    expect(ids).toContain('i79')
    expect(ids).not.toContain('i80')
    expect(new Set(ids).size).toBe(ids.length)
    expect(patch.degraded).toEqual(['archive'])
    expect(patch.brief).toEqual(emptyBrief(['coverage']))
    expect(patch.phase).toBe('compose')
  })

  it('kappt auf 120 Kandidaten — Hand zuerst, die schwaechsten Top-Anfuehrer fallen weg', async () => {
    const base = snap(200)
    const handIds = base.items.slice(150).map((i) => i.id)
    const embeddings = new Map(base.items.map((i) => [i.id, [1]]))
    m.loadPoolEmbeddings.mockResolvedValue({ embeddings, generated: 0, failed: 0 })
    m.buildArchiveBrief.mockResolvedValue(emptyBrief())
    const patch = await phaseArchive(deps(), run({ phase: 'archive', pool: { ...base, handIds }, story_keys: emptyCluster() }))
    const ids = m.buildArchiveBrief.mock.calls[0][1].candidates.map((c: { id: string }) => c.id)
    expect(ids).toHaveLength(120)
    expect(ids.slice(0, 50)).toEqual(handIds)
    expect(ids[119]).toBe('i69')
    expect(patch.degraded).toEqual([])
  })
})

describe('phaseCompose', () => {
  const ready = () => run({
    phase: 'compose', pool: snap(50), cards: [], story_keys: emptyCluster(), brief: null, baseline: { total_score: { '10': [], '20': [] } },
  })

  it('Hard-Verstoss → genau eine Revision; nach zwei Versuchen Baseline-Plan + compose_fallback', async () => {
    m.composeDay.mockResolvedValue({ plan: plan(), costUsd: 0.5, model: 'o' })
    m.checkHardRules.mockReturnValue(['cover_count:2'])
    m.critiqueWithModel.mockResolvedValue({ hard: [], soft: [], costUsd: 0.05 })
    const patch = await phaseCompose(deps(), ready())
    expect(m.composeDay).toHaveBeenCalledTimes(2)
    expect(patch.plan?.source).toBe('baseline')
    expect(patch.degraded).toContain('compose_fallback')
    expect(patch.compose_attempts).toBe(2)
  })

  it('Budget reicht nicht fuer den Kritiker → degraded critic, Plan bleibt', async () => {
    m.composeDay.mockResolvedValue({ plan: plan(), costUsd: 3.9, model: 'o' })
    m.checkHardRules.mockReturnValue([])
    const patch = await phaseCompose(deps(), ready())
    expect(m.critiqueWithModel).not.toHaveBeenCalled()
    expect(patch.degraded).toContain('critic')
    expect(patch.degraded).toContain('budget')
    expect(patch.plan?.source).toBe('model')
  })

  it('Budget reicht nicht fuer compose → Baseline-Plan + budget', async () => {
    const patch = await phaseCompose(deps(), { ...ready(), spend_usd: 3.95 })
    expect(m.composeDay).not.toHaveBeenCalled()
    expect(patch.degraded).toContain('budget')
    expect(patch.plan?.source).toBe('baseline')
  })

  it('Revision bekommt Hinweise und Vorplan; Seed je Tag und Versuch; compose_attempts + Reservierung VOR dem Call persistiert', async () => {
    const first = { ...plan(), thesis: 'erst' }
    const second = { ...plan(), thesis: 'zwei' }
    m.composeDay
      .mockResolvedValueOnce({ plan: first, costUsd: 0.5, model: 'o' })
      .mockResolvedValueOnce({ plan: second, costUsd: 0.5, model: 'o' })
    m.checkHardRules.mockReturnValueOnce(['cover_count:2']).mockReturnValueOnce([])
    m.checkSoftRules.mockReturnValue(['held_many:6'])
    m.critiqueWithModel.mockResolvedValue({ hard: ['m'], soft: ['w'], costUsd: 0.05 })
    const patch = await phaseCompose(deps(), ready())
    const [call1, call2] = m.composeDay.mock.calls
    expect(call1[1].seed).toBe(20261015)
    expect(call1[1].revisionHints).toBeUndefined()
    expect(call2[1].seed).toBe(20261016)
    expect(call2[1].revisionHints).toEqual(['cover_count:2'])
    expect(call2[1].previousPlan).toBe(first)
    expect(patch.plan).toBe(second)
    expect(patch.compose_attempts).toBe(2)
    expect(patch.critique).toEqual({ hard: [], soft: ['held_many:6'], model_hard: ['m'], model_soft: ['w'] })
    expect(patch.spend_usd).toBeCloseTo(1.1)
    expect(patch.degraded).toEqual([])
    expect(m.saveRunState.mock.calls[0][1]).toBe('r')
    expect(m.saveRunState.mock.calls[0][2].compose_attempts).toBe(1)
    expect(m.saveRunState.mock.calls[0][2].spend_usd).toBeCloseTo(0.6, 3)
    expect(m.saveRunState.mock.invocationCallOrder[0]).toBeLessThan(m.composeDay.mock.invocationCallOrder[0])
  })

  it('nach einem Timeout mit compose_attempts 2 → kein weiterer Call, Baseline + compose_fallback', async () => {
    const patch = await phaseCompose(deps(), { ...ready(), compose_attempts: 2 })
    expect(m.composeDay).not.toHaveBeenCalled()
    expect(patch.plan?.source).toBe('baseline')
    expect(patch.degraded).toEqual(['compose_fallback'])
  })

  it('Kritiker wirft → degraded critic, Plan bleibt, Fehler im Log', async () => {
    m.composeDay.mockResolvedValue({ plan: plan(), costUsd: 0.5, model: 'o' })
    m.checkHardRules.mockReturnValue([])
    m.critiqueWithModel.mockRejectedValueOnce(new Error('kaputt'))
    const log = vi.fn()
    const patch = await phaseCompose(deps({ log }), ready())
    expect(patch.plan?.source).toBe('model')
    expect(patch.degraded).toEqual(['critic'])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('kaputt'))
  })

  it('critic_enabled false → kein Kritiker-Call, degraded critic', async () => {
    m.composeDay.mockResolvedValue({ plan: plan(), costUsd: 0.5, model: 'o' })
    m.checkHardRules.mockReturnValue([])
    const patch = await phaseCompose(deps({ settings: { ...DEFAULT_CURATION_SETTINGS, critic_enabled: false } }), ready())
    expect(m.critiqueWithModel).not.toHaveBeenCalled()
    expect(patch.degraded).toEqual(['critic'])
    expect(patch.plan?.source).toBe('model')
  })
})

it('reserveBudget', () => {
  expect(reserveBudget(run({ spend_usd: 3 }), 0.9)).toBe(true)
  expect(reserveBudget(run({ spend_usd: 3 }), 1.1)).toBe(false)
})

it('unitsFromPlan: Plan-Felder 1:1, Ergebnisfelder null', () => {
  expect(unitsFromPlan({ ...plan(), units: [unit] })).toEqual([{
    ...unit, panel_action: null, panel_at: null, outcome: null, final_role: null, final_rank: null,
    matched_post_id: null, matched_heading: null, similarity: null,
  }])
})

it('runDayInline: ohne Tick-Budget bis finished, liefert den frisch gelesenen Run', async () => {
  mockHappyRun()
  let t = 0
  const d = deps({ now: () => (t += 1_000_000), budgetMs: 1 })
  m.getRun.mockResolvedValue({ ...run(), phase: 'finished', status: 'done' })
  const out = await runDayInline(d, run())
  expect(out.status).toBe('done')
  expect(m.finishRun).toHaveBeenCalledWith(d.supabase, 'r', 'done')
  expect(m.getRun).toHaveBeenCalledWith(d.supabase, 'r')
})
