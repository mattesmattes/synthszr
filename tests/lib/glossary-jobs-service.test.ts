/**
 * Job-Service der servergetriebenen Lexikonlaeufe.
 *
 * Testmuster wie glossary-detail.test.ts: pro Tabelle eine FIFO-Queue, jede
 * Filtermethode bleibt ein vi.fn(), damit auch die Constraints prüfbar sind.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  fallback: { data: null as unknown, error: null as unknown },
  chains: {} as Record<string, any[]>,
}))

function makeChain(table: string) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'in', 'is', 'or', 'lt', 'order', 'limit', 'range', 'update', 'insert']) {
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

const client = { from: vi.fn((t: string) => makeChain(t)) } as any

beforeEach(() => {
  state.queues = {}
  state.chains = {}
  state.fallback = { data: null, error: null }
})

const JOB = {
  id: 'j1', kind: 'generate', status: 'pending', total: 47, done_count: 0,
  log: [], cancel_requested: false, last_advanced_at: null, attempts: 0,
  params: {}, error_message: null, created_at: '2026-08-05T10:00:00Z', finished_at: null,
}

describe('createOrGetJob', () => {
  it('legt einen Job an und gibt ihn zurueck', async () => {
    const { createOrGetJob } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: JOB, error: null }]

    const job = await createOrGetJob(client, 'generate', {})

    expect(job.id).toBe('j1')
    expect(job.kind).toBe('generate')
  })

  it('gibt bei verletztem Unique-Index den bestehenden offenen Job zurueck', async () => {
    // 23505 = unique_violation. Der partielle Index laesst nur einen offenen
    // Job je Art zu; ein zweiter Klick darf deshalb nicht scheitern, sondern
    // muss den laufenden Lauf liefern.
    const { createOrGetJob } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: { ...JOB, status: 'processing', done_count: 3 }, error: null },
    ]

    const job = await createOrGetJob(client, 'generate', {})

    expect(job.status).toBe('processing')
    expect(job.done_count).toBe(3)
  })
})

describe('getJobStatus', () => {
  it('liefert den offenen Job', async () => {
    const { getJobStatus } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: { ...JOB, status: 'processing' }, error: null }]

    const job = await getJobStatus(client, 'generate')

    expect(job?.status).toBe('processing')
  })

  it('liefert ohne offenen Job den juengsten abgeschlossenen', async () => {
    // Sonst wuerde das Panel nach Abschluss leer — der Betreiber soll Ergebnis
    // und Protokoll noch sehen.
    const { getJobStatus } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [
      { data: null, error: null },
      { data: { ...JOB, status: 'done', done_count: 47 }, error: null },
    ]

    const job = await getJobStatus(client, 'generate')

    expect(job?.status).toBe('done')
    expect(job?.done_count).toBe(47)
  })
})

describe('getNextOpenJob', () => {
  it('filtert Jobs mit frischem Lease heraus', async () => {
    // Der Filter muss "last_advanced_at ist null ODER aelter als die
    // Lease-Grenze" ausdruecken, sonst greift ein zweiter Minutentick in einen
    // laufenden Job.
    const { getNextOpenJob, LEASE_STALE_MS } = await import('@/lib/glossary/jobs/service')
    const now = Date.parse('2026-08-05T12:00:00Z')
    state.queues['glossary_jobs'] = [{ data: null, error: null }]

    await getNextOpenJob(client, now)

    const chain = state.chains['glossary_jobs'][0]
    const expected = new Date(now - LEASE_STALE_MS).toISOString()
    expect(chain.or).toHaveBeenCalledWith(
      `last_advanced_at.is.null,last_advanced_at.lt.${expected}`,
    )
    expect(chain.in).toHaveBeenCalledWith('status', ['pending', 'processing'])
  })

  it('nimmt den aeltesten offenen Job', async () => {
    const { getNextOpenJob } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: { ...JOB, id: 'alt' }, error: null }]

    const job = await getNextOpenJob(client, Date.parse('2026-08-05T12:00:00Z'))

    expect(job?.id).toBe('alt')
    expect(state.chains['glossary_jobs'][0].order).toHaveBeenCalledWith('created_at', { ascending: true })
  })
})

describe('appendLog', () => {
  it('haengt an das bestehende Protokoll an und zaehlt hoch', async () => {
    const { appendLog } = await import('@/lib/glossary/jobs/service')
    const job = { ...JOB, log: [{ at: '10:00:00', text: 'A', ok: true }], done_count: 1 } as any
    state.queues['glossary_jobs'] = [{ data: null, error: null }]

    await appendLog(client, job, [{ at: '10:02:00', text: 'B', ok: true }], 1)

    const chain = state.chains['glossary_jobs'][0]
    const payload = chain.update.mock.calls[0][0]
    expect(payload.log).toEqual([
      { at: '10:00:00', text: 'A', ok: true },
      { at: '10:02:00', text: 'B', ok: true },
    ])
    expect(payload.done_count).toBe(2)
    // Jede Protokollzeile stempelt das Lease neu: so bleibt der Job auch bei
    // einem langen Tick als "in Arbeit" erkennbar.
    expect(payload.last_advanced_at).toBeTypeOf('string')
  })
})

describe('requestCancel', () => {
  it('setzt cancel_requested nur auf offenen Jobs', async () => {
    const { requestCancel } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: null, error: null }]

    await requestCancel(client, 'generate')

    const chain = state.chains['glossary_jobs'][0]
    expect(chain.update).toHaveBeenCalledWith({ cancel_requested: true })
    expect(chain.in).toHaveBeenCalledWith('status', ['pending', 'processing'])
  })
})

describe('finishJob', () => {
  it('setzt Status, finished_at und die Fehlermeldung', async () => {
    const { finishJob } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: null, error: null }]

    await finishJob(client, 'j1', 'error', 'Modell dauerhaft ueberlastet')

    const payload = state.chains['glossary_jobs'][0].update.mock.calls[0][0]
    expect(payload.status).toBe('error')
    expect(payload.error_message).toBe('Modell dauerhaft ueberlastet')
    expect(payload.finished_at).toBeTypeOf('string')
  })
})
