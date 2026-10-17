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
  claimRun: vi.fn(), spentTodayUsd: vi.fn(),
}))
vi.mock('@/lib/curation/pool', () => ({ loadPoolAsOf: m.loadPoolAsOf, loadPoolEmbeddings: m.loadPoolEmbeddings }))
vi.mock('@/lib/curation/cluster', () => ({ clusterPool: m.clusterPool, handStoriesOf: () => ({}), leaderOf: (c: any, k: string) => k }))
vi.mock('@/lib/curation/scout', () => ({ scoutBatch: m.scoutBatch, loadCachedCards: m.loadCachedCards, saveCards: m.saveCards, fallbackCard: (i: any) => ({ id: i.id, core: i.title }), batchesOf: (a: any[], n: number) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o } }))
vi.mock('@/lib/curation/archive', () => ({ buildArchiveBrief: m.buildArchiveBrief }))
vi.mock('@/lib/curation/compose', () => ({ composeDay: m.composeDay, baselinePlan: m.baselinePlan, buildComposeMessages: () => ({ cachedPrefix: 'p', system: 's', user: 'u' }) }))
vi.mock('@/lib/curation/critic', () => ({ checkHardRules: m.checkHardRules, checkSoftRules: m.checkSoftRules, critiqueWithModel: m.critiqueWithModel, revisionHints: (h: string[]) => h }))
vi.mock('@/lib/curation/service', async (orig) => ({
  ...(await orig() as object), saveRunState: m.saveRunState, appendRunLog: m.appendRunLog, finishRun: m.finishRun, insertUnits: m.insertUnits, getRun: m.getRun,
  claimRun: m.claimRun, spentTodayUsd: m.spentTodayUsd,
}))
import { CallInvalidError, CallRefusedError } from '@/lib/ai/call'
import {
  advanceRun, phaseArchive, phaseCluster, phaseCompose, phaseScout, reserveBudget, runDayInline, unitsFromPlan, POOL_MIN_ITEMS, RunClaimLostError,
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
  error_message: null, created_at: '', finished_at: null, label: null, ...over,
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
  m.claimRun.mockResolvedValue(true)
  m.spentTodayUsd.mockResolvedValue(0)
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
    m.scoutBatch.mockImplementation(async (_call: unknown, batch: Array<{ id: string }>) => {
      t += 200_000
      // Cards fuer alle Items, sonst liefe der Nachpass (2026-10-17) und verschoebe die Uhr noch einmal.
      return { cards: batch.map((i) => ({ id: i.id, core: 'k' })), missing: [], costUsd: 0.1 }
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

  it('R27: jeder Phasenwechsel setzt attempts auf 0 zurueck', async () => {
    mockHappyRun()
    await advanceRun(deps(), run({ attempts: 7 }))
    const phasePatches = m.saveRunState.mock.calls.map((c) => c[2]).filter((p) => 'phase' in p)
    expect(phasePatches).toHaveLength(6)
    expect(phasePatches.every((p) => p.attempts === 0)).toBe(true)
  })

  it('R24: Shadow laedt die fremden Tagesausgaben einmal am Eintritt, Backtest nicht', async () => {
    mockHappyRun()
    const d = deps()
    await advanceRun(d, run())
    expect(m.spentTodayUsd).toHaveBeenCalledTimes(1)
    expect(m.spentTodayUsd).toHaveBeenCalledWith(d.supabase, '2026-10-15', 'r')
    m.spentTodayUsd.mockClear()
    await advanceRun(deps(), run({ mode: 'backtest' }))
    expect(m.spentTodayUsd).not.toHaveBeenCalled()
  })

  it('R24: Tageskappe ausgeschoepft → Scout und Compose ohne Call, budget', async () => {
    mockHappyRun()
    m.spentTodayUsd.mockResolvedValue(11.99)
    const d = deps()
    await advanceRun(d, run())
    expect(m.scoutBatch).not.toHaveBeenCalled()
    expect(m.composeDay).not.toHaveBeenCalled()
    const last = m.saveRunState.mock.calls.map((c) => c[2]).filter((p) => 'plan' in p).at(-1)
    expect(last.plan.source).toBe('baseline')
    expect(last.degraded).toContain('budget')
  })

  it('R28 (Minor 9): cancel_requested → finishRun cancelled am Eintritt, keine Arbeit', async () => {
    const d = deps()
    const r = await advanceRun(d, run({ cancel_requested: true, phase: 'compose' }))
    expect(r).toEqual({ phase: 'compose', finished: true, note: 'cancel_requested' })
    expect(m.finishRun).toHaveBeenCalledWith(d.supabase, 'r', 'cancelled', 'cancel_requested')
    expect(m.saveRunState).not.toHaveBeenCalled()
    expect(m.spentTodayUsd).not.toHaveBeenCalled()
    expect(m.loadPoolAsOf).not.toHaveBeenCalled()
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
    // Nachpass (2026-10-17): i3/i4 blieben ohne Card → einmal einzeln nachgescoutet (ceil(2 / 5) = 1), hier wieder ohne Erfolg
    expect(m.scoutBatch.mock.calls.map((c) => c[1].map((i: { id: string }) => i.id))).toEqual([['i1', 'i2'], ['i3', 'i4'], ['i3'], ['i4']])
    expect(m.saveCards).toHaveBeenCalledTimes(1)
    expect(m.saveCards).toHaveBeenCalledWith(d.supabase, [{ id: 'i1', core: 'k1' }, { id: 'i2', core: 'k2' }], 'h')
    expect(patch.cards).toEqual([
      { id: 'i0', core: 'gecacht' }, { id: 'i1', core: 'k1' }, { id: 'i2', core: 'k2' }, { id: 'i3', core: 'T3' }, { id: 'i4', core: 'T4' },
    ])
    expect(patch.spend_usd).toBeCloseTo(1.07)
    expect(patch.degraded).toEqual(['scout_partial'])
    expect(patch.phase).toBe('cluster')
  })

  it('Nachpass (2026-10-17): vom Modell ausgelassene Items werden einmal in kleineren Batches nachgescoutet', async () => {
    m.loadCachedCards.mockResolvedValue(new Map())
    m.scoutBatch.mockImplementation(async (_call: unknown, batch: Array<{ id: string }>) => {
      if (batch.length === 5) {
        const miss = batch.filter((i) => i.id === 'i2' || i.id === 'i7')
        return { cards: batch.filter((i) => !miss.includes(i)).map((i) => ({ id: i.id, core: 'k' })), missing: miss.map((i) => i.id), costUsd: 0.1 }
      }
      return { cards: [{ id: batch[0].id, core: 'nach' }], missing: [], costUsd: 0.01 }
    })
    const d = deps({ settings: { ...DEFAULT_CURATION_SETTINGS, scout_batch_size: 5 } })
    const patch = await phaseScout(d, run({ phase: 'scout', pool: snap(10) }))
    expect(m.scoutBatch.mock.calls.map((c) => c[1].map((i: { id: string }) => i.id))).toEqual([
      ['i0', 'i1', 'i2', 'i3', 'i4'], ['i5', 'i6', 'i7', 'i8', 'i9'], ['i2'], ['i7'],
    ])
    expect(patch.cards!.find((c) => c.id === 'i2')).toEqual({ id: 'i2', core: 'nach' })
    expect(patch.cards!.find((c) => c.id === 'i7')).toEqual({ id: 'i7', core: 'nach' })
    expect(m.saveCards).toHaveBeenCalledTimes(4)
    expect(m.saveCards).toHaveBeenLastCalledWith(d.supabase, [{ id: 'i7', core: 'nach' }], 'h')
    expect(patch.spend_usd).toBeCloseTo(0.22)
    expect(patch.degraded).toEqual([])
  })

  it('Nachpass: danach noch fehlende Items bekommen die Fallback-Card; ueber 10 % → scout_partial', async () => {
    m.loadCachedCards.mockResolvedValue(new Map())
    m.scoutBatch.mockImplementation(async (_call: unknown, batch: Array<{ id: string }>) => {
      if (batch.length === 5) {
        const miss = batch.filter((i) => ['i0', 'i1', 'i2'].includes(i.id))
        return { cards: batch.filter((i) => !miss.includes(i)).map((i) => ({ id: i.id, core: 'k' })), missing: miss.map((i) => i.id), costUsd: 0.1 }
      }
      return batch[0].id === 'i0'
        ? { cards: [{ id: 'i0', core: 'nach' }], missing: [], costUsd: 0.01 }
        : { cards: [], missing: [batch[0].id], costUsd: 0.01 }
    })
    const patch = await phaseScout(deps({ settings: { ...DEFAULT_CURATION_SETTINGS, scout_batch_size: 5 } }), run({ phase: 'scout', pool: snap(10) }))
    expect(m.scoutBatch).toHaveBeenCalledTimes(5)
    expect(patch.cards!.slice(0, 3)).toEqual([{ id: 'i0', core: 'nach' }, { id: 'i1', core: 'T1' }, { id: 'i2', core: 'T2' }])
    expect(patch.spend_usd).toBeCloseTo(0.23)
    expect(patch.degraded).toEqual(['scout_partial'])
  })

  it('Nachpass respektiert das Run-Budget: reicht es nach dem ersten Durchgang nicht mehr → kein zweiter Call, budget + scout_partial', async () => {
    m.loadCachedCards.mockResolvedValue(new Map())
    m.scoutBatch.mockResolvedValue({ cards: [], missing: ['i0'], costUsd: 0.05 })
    const patch = await phaseScout(deps({ settings: { ...DEFAULT_CURATION_SETTINGS, scout_batch_size: 1 } }), run({ phase: 'scout', pool: snap(1), spend_usd: 3.85 }))
    expect(m.scoutBatch).toHaveBeenCalledTimes(1)
    expect(patch.degraded).toEqual(['budget', 'scout_partial'])
    expect(patch.spend_usd).toBeCloseTo(3.9)
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
    m.scoutBatch.mockImplementation(async (_call: unknown, batch: Array<{ id: string }>) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 0))
      active--
      return { cards: batch.map((i) => ({ id: i.id, core: 'k' })), missing: [], costUsd: 0 }
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

  it('R25: reicht mode und label des Runs an buildArchiveBrief durch', async () => {
    m.buildArchiveBrief.mockResolvedValue(emptyBrief())
    await phaseArchive(deps(), run({ phase: 'archive', mode: 'backtest', label: 'bt-full-20261014', pool: snap(3), story_keys: emptyCluster() }))
    expect(m.buildArchiveBrief.mock.calls[0][1]).toMatchObject({ mode: 'backtest', label: 'bt-full-20261014' })
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

  it('R28 (Minor 12): Baseline-Fallback wird gegen die harten Regeln geprueft, Verstoesse stehen in critique', async () => {
    m.composeDay.mockResolvedValue({ plan: plan(), costUsd: 0.5, model: 'o' })
    m.checkHardRules
      .mockReturnValueOnce(['cover_count:2'])
      .mockReturnValueOnce(['cover_count:2'])
      .mockReturnValueOnce(['story_duplicate:x'])
    m.checkSoftRules.mockReturnValue(['held_many:6'])
    m.critiqueWithModel.mockResolvedValue({ hard: ['m'], soft: ['w'], costUsd: 0.05 })
    const patch = await phaseCompose(deps(), ready())
    expect(patch.plan?.source).toBe('baseline')
    expect(m.checkHardRules).toHaveBeenCalledTimes(3)
    expect(m.checkHardRules.mock.calls[2][0]).toBe(patch.plan)
    expect(patch.critique).toEqual({ hard: ['story_duplicate:x'], soft: ['held_many:6'], model_hard: [], model_soft: [] })
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

  it('R24: Kritiker wirft CallInvalidError → dessen Kosten in spend_usd, Reservierung VOR dem Call persistiert', async () => {
    m.composeDay.mockResolvedValue({ plan: plan(), costUsd: 0.5, model: 'o' })
    m.checkHardRules.mockReturnValue([])
    m.critiqueWithModel.mockRejectedValueOnce(new CallInvalidError('curation_critic', 0.3))
    const patch = await phaseCompose(deps(), ready())
    expect(patch.spend_usd).toBeCloseTo(0.8)
    expect(patch.degraded).toEqual(['critic'])
    const reservation = m.saveRunState.mock.calls[1]
    expect(reservation[1]).toBe('r')
    expect(reservation[2].spend_usd).toBeGreaterThan(0.5)
    expect(m.saveRunState.mock.invocationCallOrder[1]).toBeLessThan(m.critiqueWithModel.mock.invocationCallOrder[0])
  })

  it('R24: Tageskappe greift auch fuer compose (Shadow); Backtest prueft nur das Run-Budget', async () => {
    const capped = await phaseCompose(deps({ spentTodayUsd: 11.5 }), ready())
    expect(m.composeDay).not.toHaveBeenCalled()
    expect(capped.plan?.source).toBe('baseline')
    expect(capped.degraded).toContain('budget')

    m.composeDay.mockResolvedValue({ plan: plan(), costUsd: 0.5, model: 'o' })
    m.checkHardRules.mockReturnValue([])
    m.critiqueWithModel.mockResolvedValue({ hard: [], soft: [], costUsd: 0.05 })
    const backtest = await phaseCompose(deps({ spentTodayUsd: 11.5 }), { ...ready(), mode: 'backtest' })
    expect(m.composeDay).toHaveBeenCalledTimes(1)
    expect(backtest.plan?.source).toBe('model')
  })

  it('R26: composeDay wirft CallInvalidError → Versuch zaehlt, Kosten gebucht, zweiter Versuch liefert den Plan', async () => {
    const second = { ...plan(), thesis: 'zwei' }
    m.composeDay
      .mockRejectedValueOnce(new CallInvalidError('curation_editor', 0.4))
      .mockResolvedValueOnce({ plan: second, costUsd: 0.5, model: 'o' })
    m.checkHardRules.mockReturnValue([])
    m.critiqueWithModel.mockResolvedValue({ hard: [], soft: [], costUsd: 0.05 })
    const r = ready()
    const patch = await phaseCompose(deps(), r)
    expect(m.composeDay).toHaveBeenCalledTimes(2)
    expect(m.composeDay.mock.calls[1][1].seed).toBe(20261016)
    expect(patch.plan).toBe(second)
    expect(patch.compose_attempts).toBe(2)
    expect(patch.spend_usd).toBeCloseTo(0.95)
    expect(patch.degraded).toEqual([])
    expect(m.appendRunLog).toHaveBeenCalledWith({}, r, [expect.objectContaining({ text: expect.stringContaining('compose-Versuch 1 gescheitert'), ok: false })])
  })

  it('R26: zweimal CallInvalidError/CallRefusedError → Baseline + compose_fallback, beide Fehlerkosten gebucht', async () => {
    m.composeDay
      .mockRejectedValueOnce(new CallInvalidError('curation_editor', 0.4))
      .mockRejectedValueOnce(new CallRefusedError('curation_editor', 'cyber', 0.3))
    const patch = await phaseCompose(deps(), ready())
    expect(m.composeDay).toHaveBeenCalledTimes(2)
    expect(m.critiqueWithModel).not.toHaveBeenCalled()
    expect(patch.plan?.source).toBe('baseline')
    expect(patch.degraded).toEqual(['compose_fallback'])
    expect(patch.compose_attempts).toBe(2)
    expect(patch.spend_usd).toBeCloseTo(0.7)
    expect(patch.phase).toBe('units')
  })

  it('R26: andere Fehler aus composeDay werden weitergeworfen', async () => {
    m.composeDay.mockRejectedValueOnce(new Error('anthropic: 529 overloaded'))
    await expect(phaseCompose(deps(), ready())).rejects.toThrow('529 overloaded')
    expect(m.composeDay).toHaveBeenCalledTimes(1)
  })

  it('critic_enabled false → kein Kritiker-Call, degraded critic', async () => {
    m.composeDay.mockResolvedValue({ plan: plan(), costUsd: 0.5, model: 'o' })
    m.checkHardRules.mockReturnValue([])
    const patch = await phaseCompose(deps({ settings: { ...DEFAULT_CURATION_SETTINGS, critic_enabled: false } }), ready())
    expect(m.critiqueWithModel).not.toHaveBeenCalled()
    expect(patch.degraded).toEqual(['critic'])
    expect(patch.plan?.source).toBe('model')
  })

  // Ruling R11: Restzeit vor JEDEM Versuch, Vertagung statt Fallback, Wiederaufnahme aus plan + critique.
  const savedCritique = () => ({ hard: ['cover_count:2'], soft: [], model_hard: [], model_soft: [] })
  const resumed = (saved: ReturnType<typeof plan>) => ({ ...ready(), compose_attempts: 1, plan: saved, critique: savedCritique(), spend_usd: 0.7 })

  it('R11 (a): Restzeit 300 s beim Eintritt in compose → kein Call, Phase bleibt compose, finished false', async () => {
    const r = await advanceRun(deps({ budgetMs: 300_000 }), ready())
    expect(r).toMatchObject({ phase: 'compose', finished: false })
    expect(m.composeDay).not.toHaveBeenCalled()
  })

  it('R11 (a): phaseCompose vertagt selbst vor dem ersten Versuch und behaelt den Zwischenstand des Runs', async () => {
    const saved = { ...plan(), thesis: 'aus Tick 1' }
    const patch = await phaseCompose(deps({ deadline: 300_000 }), resumed(saved))
    expect(m.composeDay).not.toHaveBeenCalled()
    expect(m.baselinePlan).not.toHaveBeenCalled()
    expect(patch).toEqual({ plan: saved, critique: savedCritique(), compose_attempts: 1, spend_usd: 0.7, degraded: [], phase: 'compose' })
  })

  it('R11 (b): Versuch 1 mit Hard-Verstoss, danach < 420 s Rest → vertagt mit Modellplan und Kritik, kein compose_fallback', async () => {
    let t = 0
    m.composeDay.mockImplementation(async () => {
      t += 300_000
      return { plan: plan(), costUsd: 0.5, model: 'o' }
    })
    m.checkHardRules.mockReturnValue(['cover_count:2'])
    m.critiqueWithModel.mockResolvedValue({ hard: [], soft: [], costUsd: 0.05 })
    const r = await advanceRun(deps({ now: () => t, budgetMs: 600_000 }), ready())
    expect(m.composeDay).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ phase: 'compose', finished: false })
    expect(r.note).toContain('vertagt')
    const patch = m.saveRunState.mock.calls.at(-1)![2]
    expect(patch.phase).toBe('compose')
    expect(patch.plan.source).toBe('model')
    expect(patch.critique.hard).toEqual(['cover_count:2'])
    expect(patch.compose_attempts).toBe(1)
    expect(patch.spend_usd).toBeCloseTo(0.55)
    expect(patch.degraded).not.toContain('compose_fallback')
    expect(m.baselinePlan).not.toHaveBeenCalled()
    // R27: Vertagung ohne Phasenwechsel ist kein Fortschritt — attempts bleibt stehen.
    expect(patch.attempts).toBeUndefined()
    expect(m.appendRunLog.mock.calls.at(-1)![2][0].text).toContain('Phase compose vertagt')
    expect(m.finishRun).not.toHaveBeenCalled()
  })

  it('R11 (c): Wiederaufnahme — Revision mit gesicherten Hinweisen und Vorplan; erneuter Hard-Verstoss → Baseline + compose_fallback', async () => {
    const saved = { ...plan(), thesis: 'aus Tick 1' }
    m.composeDay.mockResolvedValue({ plan: plan(), costUsd: 0.5, model: 'o' })
    m.checkHardRules.mockReturnValue(['cover_count:2'])
    m.critiqueWithModel.mockResolvedValue({ hard: [], soft: [], costUsd: 0.05 })
    const patch = await phaseCompose(deps({ deadline: 600_000 }), resumed(saved))
    expect(m.composeDay).toHaveBeenCalledTimes(1)
    const input = m.composeDay.mock.calls[0][1]
    expect(input.revisionHints).toEqual(['cover_count:2'])
    expect(input.previousPlan).toBe(saved)
    expect(input.seed).toBe(20261016)
    expect(patch.plan?.source).toBe('baseline')
    expect(patch.degraded).toEqual(['compose_fallback'])
    expect(patch.compose_attempts).toBe(2)
    expect(patch.phase).toBe('units')
  })

  it('R11 (c): Wiederaufnahme mit sauberer Revision → Modellplan, phase units', async () => {
    const saved = { ...plan(), thesis: 'aus Tick 1' }
    const revised = { ...plan(), thesis: 'revidiert' }
    m.composeDay.mockResolvedValue({ plan: revised, costUsd: 0.5, model: 'o' })
    m.checkHardRules.mockReturnValue([])
    m.critiqueWithModel.mockResolvedValue({ hard: [], soft: [], costUsd: 0.05 })
    const patch = await phaseCompose(deps({ deadline: 600_000 }), resumed(saved))
    expect(m.composeDay).toHaveBeenCalledTimes(1)
    expect(m.composeDay.mock.calls[0][1].previousPlan).toBe(saved)
    expect(patch.plan).toBe(revised)
    expect(patch.critique?.hard).toEqual([])
    expect(patch.compose_attempts).toBe(2)
    expect(patch.degraded).toEqual([])
    expect(patch.phase).toBe('units')
  })
})

it('reserveBudget', () => {
  expect(reserveBudget(run({ spend_usd: 3 }), 0.9)).toBe(true)
  expect(reserveBudget(run({ spend_usd: 3 }), 1.1)).toBe(false)
})

it('R24: reserveBudget prueft im Shadow zusaetzlich die Tageskappe (eigener Spend + fremde Tagesausgaben)', () => {
  const daily = { settings: DEFAULT_CURATION_SETTINGS, spentTodayUsd: 8 }
  expect(reserveBudget(run({ spend_usd: 3 }), 0.9, daily)).toBe(true)
  expect(reserveBudget(run({ spend_usd: 3 }), 0.9, { ...daily, spentTodayUsd: 8.5 })).toBe(false)
  expect(reserveBudget(run({ spend_usd: 3, mode: 'backtest' }), 0.9, { ...daily, spentTodayUsd: 8.5 })).toBe(true)
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

it('R23/R24: runDayInline claimt den Run vor der Arbeit und laedt die Tagesausgaben genau einmal', async () => {
  mockHappyRun()
  const d = deps()
  m.getRun.mockResolvedValue({ ...run(), phase: 'finished', status: 'done' })
  await runDayInline(d, run({ attempts: 1 }))
  expect(m.claimRun).toHaveBeenCalledWith(d.supabase, 'r', 2)
  expect(m.claimRun.mock.invocationCallOrder[0]).toBeLessThan(m.loadPoolAsOf.mock.invocationCallOrder[0])
  expect(m.spentTodayUsd).toHaveBeenCalledTimes(1)
})

it('R23: runDayInline wirft RunClaimLostError, wenn ein anderer Prozess das Lease haelt — ohne Arbeit', async () => {
  m.claimRun.mockResolvedValueOnce(false)
  await expect(runDayInline(deps(), run())).rejects.toBeInstanceOf(RunClaimLostError)
  expect(m.loadPoolAsOf).not.toHaveBeenCalled()
  expect(m.finishRun).not.toHaveBeenCalled()
})
