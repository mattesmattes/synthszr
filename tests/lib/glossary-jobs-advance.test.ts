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
  releaseLease: vi.fn(),
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
  releaseLease: mocks.releaseLease,
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
    // Das Lease muss frei werden, sobald der Tick ohne Ergebnis "fertig" endet —
    // sonst sieht getNextOpenJob erst nach LEASE_STALE_MS (6 Minuten) wieder
    // nach diesem Job, statt ihn im naechsten Minutentick aufzugreifen.
    expect(mocks.releaseLease).toHaveBeenCalledWith(client, 'j1')
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
    // Ein abgeschlossener Job wird nie wieder von getNextOpenJob aufgegriffen
    // (Status nicht mehr in OPEN) — die Freigabe waere hier ueberfluessig.
    expect(mocks.releaseLease).not.toHaveBeenCalled()
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
    expect(mocks.releaseLease).not.toHaveBeenCalled()
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
    // Der naechste Cron soll den Job in der naechsten Minute wieder aufgreifen,
    // nicht erst nach LEASE_STALE_MS — daher muss das Lease hier frei werden.
    expect(mocks.releaseLease).toHaveBeenCalledWith(client, 'j1')
  })

  it('bricht bei cancel_requested ab, ohne zu arbeiten', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)

    const res = await advanceJob(
      client, { ...JOB, cancel_requested: true }, { now: clock.now, budgetMs: 240_000 },
    )

    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.finishJob).toHaveBeenCalledWith(client, 'j1', 'cancelled')
    expect(mocks.releaseLease).not.toHaveBeenCalled()
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

  it('images: haengt der Batch dauerhaft fest (done leer, aber Rest offen), endet der Tick nach EINEM Versuch', async () => {
    // Regressionstest fuer den Review-Befund: generateMissingIllustrations hat
    // kein retryable-Signal. Ohne Ueberlast-Erkennung waere "remaining > 0"
    // gleichzeitig "exhausted: false" UND "overloaded: false" — die
    // for(;;)-Schleife haette denselben deterministischen Batch (order('slug'))
    // erneut aufgerufen, bis das ganze 240s-Budget verbraucht ist.
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.images.mockImplementation(async () => {
      clock.advance()
      return { done: [], failed: ['broken-term'], remaining: 3 }
    })

    const res = await advanceJob(
      client, { ...JOB, kind: 'images' }, { now: clock.now, budgetMs: 240_000 },
    )

    expect(mocks.images).toHaveBeenCalledTimes(1)
    expect(res.finished).toBe(false)
    expect(mocks.setAttempts).toHaveBeenCalledWith(client, 'j1', 1)
  })

  it('images eskaliert nach zehn erfolglosen Durchgaengen zu error', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.images.mockImplementation(async () => {
      clock.advance()
      return { done: [], failed: ['broken-term'], remaining: 3 }
    })

    const res = await advanceJob(
      client, { ...JOB, kind: 'images', attempts: 9 }, { now: clock.now, budgetMs: 240_000 },
    )

    expect(res.finished).toBe(true)
    expect(mocks.finishJob).toHaveBeenCalledWith(
      client, 'j1', 'error', expect.stringContaining('überlastet'),
    )
  })

  it('relink: findet ein Durchgang nichts (weder verlinkt noch unveraendert), endet der Tick nach EINEM Versuch', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.relink.mockImplementation(async () => {
      clock.advance()
      return { linked: [], unchanged: 0, remaining: 5, cursor: 'abc' }
    })

    const res = await advanceJob(
      client, { ...JOB, kind: 'relink' }, { now: clock.now, budgetMs: 240_000 },
    )

    expect(mocks.relink).toHaveBeenCalledTimes(1)
    expect(res.finished).toBe(false)
    expect(mocks.setAttempts).toHaveBeenCalledWith(client, 'j1', 1)
  })

  it('relink eskaliert nach zehn erfolglosen Durchgaengen zu error', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.relink.mockImplementation(async () => {
      clock.advance()
      return { linked: [], unchanged: 0, remaining: 5, cursor: 'abc' }
    })

    const res = await advanceJob(
      client, { ...JOB, kind: 'relink', attempts: 9 }, { now: clock.now, budgetMs: 240_000 },
    )

    expect(res.finished).toBe(true)
    expect(mocks.finishJob).toHaveBeenCalledWith(
      client, 'j1', 'error', expect.stringContaining('überlastet'),
    )
  })
})
