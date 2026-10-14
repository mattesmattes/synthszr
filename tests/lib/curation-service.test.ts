/**
 * DB-Helfer der Morgenkonferenz-Engine (Task 3, lib/curation/service.ts).
 * makeChain wie in anderen Supabase-Service-Tests (z. B.
 * tests/lib/queue-article-dedup-drop-event.test.ts), erweitert um `rpc`
 * (von service.ts nicht genutzt, aber Teil der SupabaseAdmin-Form) und die
 * zusaetzlichen Chain-Methoden, die curation_runs/curation_units brauchen
 * (neq, not, gt, upsert — vom Vertrag verlangt, auch wenn Task 3 sie nicht
 * alle aufruft).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendRunLog,
  claimRun,
  createRun,
  finishRun,
  getNextOpenRun,
  getRun,
  getRunsToReconcile,
  getRunUnits,
  insertUnits,
  kickoffAsOf,
  listRuns,
  loadCurationSettings,
  LEASE_STALE_MS,
  markReconciled,
  parseRunRow,
  releaseLease,
  saveRunState,
  spentTodayUsd,
  updateUnitOutcomes,
} from '@/lib/curation/service'
import { DEFAULT_CURATION_SETTINGS } from '@/lib/curation/types'

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

const RUN = {
  id: 'run-1', day: '2026-10-15', mode: 'shadow', asof: '2026-10-15T04:25:00.000Z',
  status: 'pending', phase: 'pool', brief_mode: 'full', attempts: 0,
  last_advanced_at: null, cancel_requested: false, log: [], degraded: [],
  budget_usd: '4.0000', spend_usd: '0.0000', compose_attempts: 0,
  pool: null, cards: null, story_keys: null, brief: null, baseline: null,
  plan: null, critique: null, reconciled_at: null, matched_post_id: null,
  matched_job_id: null, metrics: null, model_scout: 'h', model_editor: 'o',
  model_critic: 's', error_message: null, created_at: '2026-10-15T04:25:01.000Z',
  finished_at: null,
}

describe('kickoffAsOf', () => {
  it('heutiger Kickoff als ISO, wenn erreicht', () => {
    expect(kickoffAsOf('2026-10-15T04:26:10.000Z', '04:25')).toBe('2026-10-15T04:25:00.000Z')
  })
  it('null davor und bei ungueltiger Zeit', () => {
    expect(kickoffAsOf('2026-10-15T04:24:59.000Z', '04:25')).toBeNull()
    expect(kickoffAsOf('2026-10-15T10:00:00.000Z', '4:25')).toBeNull()
  })
})

describe('parseRunRow', () => {
  it('numeric-Strings → Zahlen', () => {
    const r = parseRunRow(RUN)
    expect(r.budget_usd).toBe(4)
    expect(r.spend_usd).toBe(0)
  })
  it('R25: fehlendes label → null', () => {
    expect(parseRunRow(RUN).label).toBeNull()
    expect(parseRunRow({ ...RUN, label: 'bt-x' }).label).toBe('bt-x')
  })
  it('fehlende log/degraded → leere Arrays', () => {
    const r = parseRunRow({ ...RUN, log: undefined, degraded: undefined })
    expect(r.log).toEqual([])
    expect(r.degraded).toEqual([])
  })
})

describe('createRun', () => {
  it('R25: schreibt label (Default null fuer Shadow)', async () => {
    state.queues.curation_runs = [{ data: RUN, error: null }, { data: RUN, error: null }]
    await createRun(client, {
      day: '2026-10-15', mode: 'backtest', asof: RUN.asof, brief_mode: 'full', label: 'bt-full-20261014',
      budget_usd: 4, models: { scout: 'h', editor: 'o', critic: 's' },
    })
    expect(state.chains.curation_runs[0].insert).toHaveBeenCalledWith(expect.objectContaining({ label: 'bt-full-20261014' }))
    await createRun(client, {
      day: '2026-10-15', mode: 'shadow', asof: RUN.asof, brief_mode: 'full',
      budget_usd: 4, models: { scout: 'h', editor: 'o', critic: 's' },
    })
    expect(state.chains.curation_runs[1].insert).toHaveBeenCalledWith(expect.objectContaining({ label: null }))
  })
  it('R25: 23505 mit offenem Run eines anderen brief_mode/label → wirft statt ihn fortzusetzen', async () => {
    state.queues.curation_runs = [
      { data: null, error: { code: '23505', message: 'duplicate' } },
      { data: { ...RUN, mode: 'backtest', brief_mode: 'precedents-only', label: 'bt-precedents-only-20261013' }, error: null },
    ]
    await expect(createRun(client, {
      day: '2026-10-15', mode: 'backtest', asof: RUN.asof, brief_mode: 'none', label: 'bt-none-20261014',
      budget_usd: 4, models: { scout: 'h', editor: 'o', critic: 's' },
    })).rejects.toThrow('curation_runs: offener Run mit anderem brief_mode/label (precedents-only/bt-precedents-only-20261013)')
  })
  it('R25: 23505 mit gleichem brief_mode und label → liefert den offenen Run', async () => {
    state.queues.curation_runs = [
      { data: null, error: { code: '23505', message: 'duplicate' } },
      { data: { ...RUN, mode: 'backtest', label: 'bt-full-20261014' }, error: null },
    ]
    const r = await createRun(client, {
      day: '2026-10-15', mode: 'backtest', asof: RUN.asof, brief_mode: 'full', label: 'bt-full-20261014',
      budget_usd: 4, models: { scout: 'h', editor: 'o', critic: 's' },
    })
    expect(r.label).toBe('bt-full-20261014')
  })
  it('liefert bei 23505 den offenen Run des Tages', async () => {
    state.queues.curation_runs = [
      { data: null, error: { code: '23505', message: 'duplicate' } },
      { data: RUN, error: null },
    ]
    const r = await createRun(client, {
      day: '2026-10-15', mode: 'shadow', asof: RUN.asof, brief_mode: 'full',
      budget_usd: 4, models: { scout: 'h', editor: 'o', critic: 's' },
    })
    expect(r.id).toBe('run-1')
    expect(state.chains.curation_runs[1].eq).toHaveBeenCalledWith('day', '2026-10-15')
    expect(state.chains.curation_runs[1].eq).toHaveBeenCalledWith('mode', 'shadow')
    expect(state.chains.curation_runs[1].in).toHaveBeenCalledWith('status', ['pending', 'processing'])
  })
  it('legt den Run normal an, wenn kein Konflikt vorliegt', async () => {
    state.queues.curation_runs = [{ data: RUN, error: null }]
    const r = await createRun(client, {
      day: '2026-10-15', mode: 'shadow', asof: RUN.asof, brief_mode: 'full',
      budget_usd: 4, models: { scout: 'h', editor: 'o', critic: 's' },
    })
    expect(r.id).toBe('run-1')
    expect(state.chains.curation_runs[0].insert).toHaveBeenCalledWith(expect.objectContaining({
      day: '2026-10-15', mode: 'shadow', model_scout: 'h', model_editor: 'o', model_critic: 's',
    }))
  })
  it('wirft bei einem anderen Fehler', async () => {
    state.queues.curation_runs = [{ data: null, error: { code: '42501', message: 'nope' } }]
    await expect(createRun(client, {
      day: '2026-10-15', mode: 'shadow', asof: RUN.asof, brief_mode: 'full',
      budget_usd: 4, models: { scout: 'h', editor: 'o', critic: 's' },
    })).rejects.toThrow('curation_runs: nope')
  })
})

describe('getRun', () => {
  it('liefert die geparste Zeile', async () => {
    state.queues.curation_runs = [{ data: RUN, error: null }]
    const r = await getRun(client, 'run-1')
    expect(r?.id).toBe('run-1')
    expect(state.chains.curation_runs[0].eq).toHaveBeenCalledWith('id', 'run-1')
  })
  it('null, wenn keine Zeile', async () => {
    state.queues.curation_runs = [{ data: null, error: null }]
    expect(await getRun(client, 'missing')).toBeNull()
  })
})

describe('getNextOpenRun', () => {
  it('nur Shadow-Runs mit abgelaufenem Lease', async () => {
    state.queues.curation_runs = [{ data: [RUN], error: null }]
    const now = Date.parse('2026-10-15T05:00:00.000Z')
    expect((await getNextOpenRun(client, now))?.id).toBe('run-1')
    const c = state.chains.curation_runs[0]
    expect(c.in).toHaveBeenCalledWith('status', ['pending', 'processing'])
    expect(c.or).toHaveBeenCalledWith(`last_advanced_at.is.null,last_advanced_at.lt.${new Date(now - LEASE_STALE_MS).toISOString()}`)
    expect(c.eq).toHaveBeenCalledWith('mode', 'shadow')
  })
  it('null, wenn nichts offen ist', async () => {
    state.queues.curation_runs = [{ data: [], error: null }]
    expect(await getNextOpenRun(client)).toBeNull()
  })
})

describe('claimRun', () => {
  it('processing + Lease + attempts in EINEM Update', async () => {
    state.queues.curation_runs = [{ data: [{ id: 'run-1' }], error: null }]
    await claimRun(client, 'run-1', 3)
    const c = state.chains.curation_runs[0]
    expect(c.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'processing', attempts: 3, last_advanced_at: expect.any(String),
    }))
    expect(c.eq).toHaveBeenCalledWith('id', 'run-1')
  })

  it('R23: Compare-and-Set — nur ohne oder mit abgelaufenem Lease und nur offene Runs; Zeile zurueck → true', async () => {
    const now = Date.parse('2026-10-15T05:00:00.000Z')
    state.queues.curation_runs = [{ data: [{ id: 'run-1' }], error: null }]
    expect(await claimRun(client, 'run-1', 1, now)).toBe(true)
    const c = state.chains.curation_runs[0]
    expect(c.or).toHaveBeenCalledWith(`last_advanced_at.is.null,last_advanced_at.lt.${new Date(now - LEASE_STALE_MS).toISOString()}`)
    expect(c.in).toHaveBeenCalledWith('status', ['pending', 'processing'])
    expect(c.select).toHaveBeenCalledWith('id')
  })

  it('R23: keine Zeile zurueck (Lease von jemand anderem gehalten) → false', async () => {
    state.queues.curation_runs = [{ data: [], error: null }]
    expect(await claimRun(client, 'run-1', 1)).toBe(false)
  })

  it('wirft bei DB-Fehler', async () => {
    state.queues.curation_runs = [{ data: null, error: { message: 'weg' } }]
    await expect(claimRun(client, 'run-1', 1)).rejects.toThrow('curation_runs: weg')
  })
})

describe('releaseLease', () => {
  it('setzt nur last_advanced_at zurueck', async () => {
    await releaseLease(client, 'run-1')
    const c = state.chains.curation_runs[0]
    expect(c.update).toHaveBeenCalledWith({ last_advanced_at: null })
    expect(c.eq).toHaveBeenCalledWith('id', 'run-1')
  })
})

describe('saveRunState', () => {
  it('schreibt den Patch und stempelt das Lease', async () => {
    await saveRunState(client, 'run-1', { phase: 'scout', spend_usd: 1.5 })
    const c = state.chains.curation_runs[0]
    expect(c.update).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'scout', spend_usd: 1.5, last_advanced_at: expect.any(String),
    }))
    expect(c.eq).toHaveBeenCalledWith('id', 'run-1')
  })
})

describe('appendRunLog', () => {
  it('haengt Zeilen an und mutiert die uebergebene Run-Kopie', async () => {
    const run = parseRunRow({ ...RUN, log: [{ at: '10:00:00', text: 'Start', ok: true }] })
    await appendRunLog(client, run, [{ at: '10:00:05', text: 'Pool geladen', ok: true }])
    expect(run.log).toEqual([
      { at: '10:00:00', text: 'Start', ok: true },
      { at: '10:00:05', text: 'Pool geladen', ok: true },
    ])
    const c = state.chains.curation_runs[0]
    expect(c.update).toHaveBeenCalledWith({
      log: run.log, last_advanced_at: expect.any(String),
    })
    expect(c.eq).toHaveBeenCalledWith('id', run.id)
  })
})

describe('finishRun', () => {
  it("'done' setzt zusaetzlich phase: 'finished'", async () => {
    await finishRun(client, 'run-1', 'done')
    const c = state.chains.curation_runs[0]
    expect(c.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'done', phase: 'finished', error_message: null, last_advanced_at: null,
    }))
  })
  it("'error' laesst die Phase unangetastet und uebernimmt die Fehlermeldung", async () => {
    await finishRun(client, 'run-1', 'error', 'Budget aufgebraucht')
    const c = state.chains.curation_runs[0]
    const patch = c.update.mock.calls[0][0]
    expect(patch).toMatchObject({ status: 'error', error_message: 'Budget aufgebraucht', last_advanced_at: null })
    expect(patch.phase).toBeUndefined()
  })
})

describe('insertUnits', () => {
  it('delete je Run, dann insert in Scheiben à 200', async () => {
    const units = Array.from({ length: 250 }, (_, i) => ({
      unit_key: `u${i}`, member_ids: [], story_key: null, role: null, rank: i + 1,
      tier: 'bench', reason: null, alternative: null, precedent_ids: [], is_hand: false,
      panel_action: null, panel_at: null, outcome: null, final_role: null, final_rank: null,
      matched_post_id: null, matched_heading: null, similarity: null,
    })) as any
    await insertUnits(client, 'run-1', units)
    const chains = state.chains.curation_units
    expect(chains[0].delete).toHaveBeenCalled()
    expect(chains[0].eq).toHaveBeenCalledWith('run_id', 'run-1')
    expect((chains[1].insert.mock.calls[0][0] as unknown[]).length).toBe(200)
    expect((chains[2].insert.mock.calls[0][0] as unknown[]).length).toBe(50)
    expect(chains[1].insert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ run_id: 'run-1', unit_key: 'u0' }),
    ]))
  })
})

describe('listRuns', () => {
  it('filtert optional nach mode und ordnet day, created_at absteigend', async () => {
    state.queues.curation_runs = [{ data: [RUN], error: null }]
    const rows = await listRuns(client, { limit: 10, mode: 'shadow' })
    expect(rows[0].id).toBe('run-1')
    const c = state.chains.curation_runs[0]
    expect(c.eq).toHaveBeenCalledWith('mode', 'shadow')
    expect(c.order).toHaveBeenNthCalledWith(1, 'day', { ascending: false })
    expect(c.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: false })
    expect(c.limit).toHaveBeenCalledWith(10)
  })
  it('ohne mode: kein eq-Filter auf mode', async () => {
    state.queues.curation_runs = [{ data: [], error: null }]
    await listRuns(client, { limit: 5 })
    expect(state.chains.curation_runs[0].eq).not.toHaveBeenCalled()
  })
})

describe('getRunUnits', () => {
  it('ordnet nach tier, dann rank', async () => {
    state.queues.curation_units = [{ data: [], error: null }]
    await getRunUnits(client, 'run-1')
    const c = state.chains.curation_units[0]
    expect(c.eq).toHaveBeenCalledWith('run_id', 'run-1')
    expect(c.order).toHaveBeenNthCalledWith(1, 'tier')
    expect(c.order).toHaveBeenNthCalledWith(2, 'rank')
  })
})

describe('getRunsToReconcile', () => {
  it('shadow + done + unreconciled + asof <= now − 24 h (Abgleichfenster, R21)', async () => {
    state.queues.curation_runs = [{ data: [RUN], error: null }]
    const rows = await getRunsToReconcile(client, '2026-10-15T05:00:00.000Z', 3)
    expect(rows[0].id).toBe('run-1')
    const c = state.chains.curation_runs[0]
    expect(c.eq).toHaveBeenCalledWith('mode', 'shadow')
    expect(c.eq).toHaveBeenCalledWith('status', 'done')
    expect(c.is).toHaveBeenCalledWith('reconciled_at', null)
    expect(c.lte).toHaveBeenCalledWith('asof', '2026-10-14T05:00:00.000Z')
    expect(c.order).toHaveBeenCalledWith('asof', { ascending: true })
    expect(c.limit).toHaveBeenCalledWith(3)
  })

  it('R21: Run mit asof vor 23 h wird NICHT geliefert, vor 25 h schon', async () => {
    const now = Date.parse('2026-10-15T05:00:00.000Z')
    state.queues.curation_runs = [{ data: [], error: null }]
    await getRunsToReconcile(client, new Date(now).toISOString(), 1)
    const cutoff = Date.parse(state.chains.curation_runs[0].lte.mock.calls[0][1])
    const asof23h = now - 23 * 3600 * 1000
    const asof25h = now - 25 * 3600 * 1000
    expect(asof23h <= cutoff).toBe(false)
    expect(asof25h <= cutoff).toBe(true)
  })
})

describe('markReconciled', () => {
  it('schreibt den Patch und stempelt reconciled_at', async () => {
    await markReconciled(client, 'run-1', { matched_post_id: 'post-1', matched_job_id: null, metrics: {} as any })
    const c = state.chains.curation_runs[0]
    expect(c.update).toHaveBeenCalledWith(expect.objectContaining({
      matched_post_id: 'post-1', matched_job_id: null, reconciled_at: expect.any(String),
    }))
    expect(c.eq).toHaveBeenCalledWith('id', 'run-1')
  })
  it('R22: metrics null schliesst einen gescheiterten Abgleich ab', async () => {
    await markReconciled(client, 'run-1', { matched_post_id: null, matched_job_id: null, metrics: null })
    const c = state.chains.curation_runs[0]
    expect(c.update).toHaveBeenCalledWith(expect.objectContaining({ metrics: null, reconciled_at: expect.any(String) }))
  })
})

describe('updateUnitOutcomes', () => {
  it('ein update je outcome, added-Zeilen in Scheiben à 200', async () => {
    const outcomes = [
      { unit_key: 'u0', outcome: 'kept' as const, final_role: 'topic', final_rank: 1, matched_post_id: 'p1', matched_heading: 'H', similarity: 0.9 },
      { unit_key: 'u1', outcome: 'dropped_after_selection' as const, final_role: null, final_rank: null, matched_post_id: null, matched_heading: null, similarity: null },
    ]
    const added = Array.from({ length: 201 }, (_, i) => ({
      unit_key: `a${i}`, member_ids: [], story_key: null, role: null, rank: null, tier: null,
      reason: null, alternative: null, precedent_ids: [], is_hand: false, panel_action: null,
      panel_at: null, outcome: 'added' as const, final_role: null, final_rank: null,
      matched_post_id: null, matched_heading: null, similarity: null,
    })) as any
    await updateUnitOutcomes(client, 'run-1', outcomes, added)
    const chains = state.chains.curation_units
    expect(chains[0].update).toHaveBeenCalledWith({
      outcome: 'kept', final_role: 'topic', final_rank: 1, matched_post_id: 'p1', matched_heading: 'H', similarity: 0.9,
    })
    expect(chains[0].eq).toHaveBeenCalledWith('run_id', 'run-1')
    expect(chains[0].eq).toHaveBeenCalledWith('unit_key', 'u0')
    expect(chains[1].eq).toHaveBeenCalledWith('unit_key', 'u1')
    expect((chains[2].insert.mock.calls[0][0] as unknown[]).length).toBe(200)
    expect((chains[3].insert.mock.calls[0][0] as unknown[]).length).toBe(1)
    expect(chains[2].insert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ run_id: 'run-1', unit_key: 'a0' }),
    ]))
  })
})

describe('spentTodayUsd', () => {
  it('summiert spend_usd clientseitig', async () => {
    state.queues.curation_runs = [{ data: [{ spend_usd: '1.5000' }, { spend_usd: '0.2500' }], error: null }]
    expect(await spentTodayUsd(client, '2026-10-15')).toBe(1.75)
    const c = state.chains.curation_runs[0]
    expect(c.eq).toHaveBeenCalledWith('day', '2026-10-15')
    expect(c.eq).toHaveBeenCalledWith('mode', 'shadow')
    expect(c.neq).not.toHaveBeenCalled()
  })
  it('R24: mit excludeRunId nur fremde Ausgaben des Tages', async () => {
    state.queues.curation_runs = [{ data: [{ spend_usd: '2.0000' }], error: null }]
    expect(await spentTodayUsd(client, '2026-10-15', 'run-1')).toBe(2)
    expect(state.chains.curation_runs[0].neq).toHaveBeenCalledWith('id', 'run-1')
  })
})

describe('loadCurationSettings', () => {
  it('merged DB-Wert ueber Defaults; Fehler → Defaults', async () => {
    state.queues.settings = [{ data: { value: { shadow_enabled: true, kickoff_utc: '04:30' } }, error: null }]
    expect(await loadCurationSettings(client)).toEqual({ ...DEFAULT_CURATION_SETTINGS, shadow_enabled: true, kickoff_utc: '04:30' })
    state.queues.settings = [{ data: null, error: { message: 'weg' } }]
    expect(await loadCurationSettings(client)).toEqual(DEFAULT_CURATION_SETTINGS)
  })
})
