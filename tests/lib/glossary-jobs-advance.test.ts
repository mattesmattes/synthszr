/**
 * Ein Cron-Tick arbeitet Einheiten ab, bis das Zeitbudget aufgebraucht ist.
 *
 * Die erste Einheit laeuft immer: fuer sie gibt es noch keinen Messwert, und
 * die belegte Obergrenze (270s, glossary-crawl/route.ts:157) bleibt unter
 * maxDuration=300. Jede weitere nur, wenn die Restzeit fuer die bisher
 * langsamste Einheit dieses Ticks reicht.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  images: vi.fn(),
  relink: vi.fn(),
  appendLog: vi.fn(),
  finishJob: vi.fn(),
  setAttempts: vi.fn(),
  stampLease: vi.fn(),
}))

vi.mock('@/lib/glossary/crawl', () => ({
  generateCandidates: mocks.generate,
  generateMissingIllustrations: mocks.images,
  relinkNextBatch: mocks.relink,
}))
vi.mock('@/lib/glossary/jobs/service', () => ({
  appendLog: mocks.appendLog,
  finishJob: mocks.finishJob,
  setAttempts: mocks.setAttempts,
  stampLease: mocks.stampLease,
}))

const client = {} as any
const JOB = {
  id: 'j1', kind: 'generate' as const, status: 'processing' as const, total: 10,
  done_count: 0, log: [], cancel_requested: false, last_advanced_at: null,
  attempts: 0, params: {}, error_message: null, created_at: '', finished_at: null,
}

beforeEach(() => vi.clearAllMocks())

/**
 * Uhr, die NUR voranspringt, wenn Arbeit getan wurde — nicht bei jedem
 * now()-Aufruf.
 *
 * Das ist wesentlich: advanceJob liest die Uhr mehrfach je Runde (Budget-Check,
 * Start der Einheit, Ende der Einheit). Eine Uhr, die bei jedem Lesen springt,
 * würde Zeit erfinden, die niemand verbraucht hat, und das Budget wäre nach
 * zwei Runden scheinbar aufgebraucht. `advance` wird deshalb von den
 * Fachfunktions-Mocks aufgerufen.
 */
function workClock(stepMs: number) {
  let t = 0
  return { now: () => t, advance: () => { t += stepMs } }
}

/** Ein Ergebnis, bei dem ein Begriff erzeugt wurde und weitere offen sind. */
const ONE_GENERATED = {
  generated: [{ name: 'Transformer', slug: 't', mentions: 3 }],
  failed: [] as string[], retryable: [] as string[], alreadyExisting: [] as string[],
}

describe('advanceJob (generate)', () => {
  it('arbeitet mehrere Einheiten, solange das Budget reicht', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    // 60s je Einheit, 240s Budget → vier Einheiten passen hinein.
    const clock = workClock(60_000)
    mocks.generate.mockImplementation(async () => { clock.advance(); return ONE_GENERATED })

    const res = await advanceJob(client, { ...JOB }, { now: clock.now, budgetMs: 240_000 })

    expect(res.units).toBe(4)
    expect(mocks.generate).toHaveBeenCalledWith(client, 1)
  })

  it('laesst die erste Einheit immer laufen, auch bei knappem Budget', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    // Eine Einheit verbraucht mehr als das ganze Budget. Sie muss trotzdem
    // laufen, sonst kaeme der Job nie voran.
    const clock = workClock(300_000)
    mocks.generate.mockImplementation(async () => { clock.advance(); return ONE_GENERATED })

    const res = await advanceJob(client, { ...JOB }, { now: clock.now, budgetMs: 240_000 })

    expect(res.units).toBe(1)
    expect(res.finished).toBe(false)
  })

  it('beendet den Job, wenn nichts mehr offen ist', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.generate.mockImplementation(async () => {
      clock.advance()
      return { generated: [], failed: [], retryable: [], alreadyExisting: [] }
    })

    const res = await advanceJob(client, { ...JOB }, { now: clock.now, budgetMs: 240_000 })

    expect(res.finished).toBe(true)
    expect(mocks.finishJob).toHaveBeenCalledWith(client, 'j1', 'done')
  })

  it('eskaliert nach zehn erfolglosen Durchgaengen zu error', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.generate.mockImplementation(async () => {
      clock.advance()
      return { generated: [], failed: [], retryable: ['Transformer'], alreadyExisting: [] }
    })

    const res = await advanceJob(client, { ...JOB, attempts: 9 }, { now: clock.now, budgetMs: 240_000 })

    expect(res.finished).toBe(true)
    expect(mocks.finishJob).toHaveBeenCalledWith(
      client, 'j1', 'error', expect.stringContaining('überlastet'),
    )
  })

  it('bleibt bei Ueberlast unter zehn Versuchen offen und beendet nur den Tick', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.generate.mockImplementation(async () => {
      clock.advance()
      return { generated: [], failed: [], retryable: ['Transformer'], alreadyExisting: [] }
    })

    const res = await advanceJob(client, { ...JOB, attempts: 2 }, { now: clock.now, budgetMs: 240_000 })

    expect(res.finished).toBe(false)
    expect(mocks.setAttempts).toHaveBeenCalledWith(client, 'j1', 3)
    expect(mocks.finishJob).not.toHaveBeenCalled()
  })

  it('bricht bei cancel_requested ab, ohne zu arbeiten', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)

    const res = await advanceJob(
      client, { ...JOB, cancel_requested: true }, { now: clock.now, budgetMs: 240_000 },
    )

    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.finishJob).toHaveBeenCalledWith(client, 'j1', 'cancelled')
  })
})

describe('advanceJob (images, relink)', () => {
  it('ruft fuer images generateMissingIllustrations und endet bei remaining 0', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.images.mockImplementation(async () => {
      clock.advance()
      return { done: ['a'], failed: [], remaining: 0 }
    })

    const res = await advanceJob(
      client, { ...JOB, kind: 'images' }, { now: clock.now, budgetMs: 240_000 },
    )

    expect(mocks.images).toHaveBeenCalledWith(client)
    expect(res.finished).toBe(true)
  })

  it('reicht bei relink das since aus params durch', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.relink.mockImplementation(async () => {
      clock.advance()
      return { linked: ['p'], unchanged: 1, remaining: 0, cursor: null }
    })

    await advanceJob(
      client,
      { ...JOB, kind: 'relink', params: { since: '2020-01-01T00:00:00.000Z' } },
      { now: clock.now, budgetMs: 240_000 },
    )

    expect(mocks.relink).toHaveBeenCalledWith(client, { since: '2020-01-01T00:00:00.000Z' })
  })
})
