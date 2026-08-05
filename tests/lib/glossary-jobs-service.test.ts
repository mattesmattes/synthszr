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
