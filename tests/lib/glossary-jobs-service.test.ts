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
  for (const m of ['select', 'eq', 'in', 'is', 'or', 'lt', 'gte', 'order', 'limit', 'range', 'update', 'insert']) {
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

describe('createOrGetJob (pending)', () => {
  it('zaehlt nur bestaetigte Kandidaten mit needsGeneration als total', async () => {
    const { createOrGetJob } = await import('@/lib/glossary/jobs/service')
    state.queues['generated_posts'] = [{
      data: {
        pending_glossary_terms: [
          { slug: 'a', name: 'A', needsGeneration: true },
          { slug: 'b', name: 'B', needsGeneration: true },
          { slug: 'c', name: 'C', needsGeneration: false },
        ],
      },
      error: null,
    }]
    state.queues['glossary_jobs'] = [{ data: { ...JOB, kind: 'pending', total: 1 }, error: null }]

    await createOrGetJob(client, 'pending', { postId: 'p1', confirmedSlugs: ['a', 'c'] })

    // 'a': bestaetigt UND braucht Erzeugung → zaehlt. 'b': braucht Erzeugung,
    // aber nicht bestaetigt → zaehlt nicht. 'c': bestaetigt, aber existiert
    // schon (needsGeneration=false) → zaehlt nicht.
    const insertPayload = state.chains['glossary_jobs'][0].insert.mock.calls[0][0]
    expect(insertPayload.total).toBe(1)
  })

  it('liefert null als total, wenn postId oder confirmedSlugs fehlen', async () => {
    const { createOrGetJob } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: { ...JOB, kind: 'pending', total: null }, error: null }]

    await createOrGetJob(client, 'pending', {})

    const insertPayload = state.chains['glossary_jobs'][0].insert.mock.calls[0][0]
    expect(insertPayload.total).toBeNull()
  })

  it('liefert bei Unique-Konflikt den offenen Job DESSELBEN Artikels, nicht irgendeinen (artikelweiser Index)', async () => {
    // Review-Fund: der Unique-Index schluesselt 'pending' jetzt nach
    // (kind, postId) statt nur nach kind. Der Konflikt-Lookup MUSS deshalb
    // nach demselben Artikel filtern — sonst liefert er den offenen Job
    // eines FREMDEN Artikels zurueck.
    const { createOrGetJob } = await import('@/lib/glossary/jobs/service')
    state.queues['generated_posts'] = [
      { data: { pending_glossary_terms: [{ slug: 'a', name: 'A', needsGeneration: true }] }, error: null },
    ]
    state.queues['glossary_jobs'] = [
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: { ...JOB, kind: 'pending', params: { postId: 'p1', confirmedSlugs: ['a'] } }, error: null },
    ]

    const job = await createOrGetJob(client, 'pending', { postId: 'p1', confirmedSlugs: ['a'] })

    expect((job.params as { postId: string }).postId).toBe('p1')
    const conflictChain = state.chains['glossary_jobs'][1]
    expect(conflictChain.eq).toHaveBeenCalledWith('params->>postId', 'p1')
  })

  it('filtert den Unique-Konflikt-Lookup NICHT nach postId, wenn keiner in params steht (generate/images/relink)', async () => {
    // Regressionsschutz: der bestehende Doppelstart-Schutz von
    // generate/images/relink darf durch den postId-Filter nicht aufgeweicht
    // werden — in Prod bereits verifiziert (ein zweiter offener generate-Job
    // scheitert heute mit 23505).
    const { createOrGetJob } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: { ...JOB, status: 'processing' }, error: null },
    ]

    await createOrGetJob(client, 'generate', {})

    const conflictChain = state.chains['glossary_jobs'][1]
    expect(conflictChain.eq).not.toHaveBeenCalledWith('params->>postId', expect.anything())
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

  it('liefert null fuer kind=pending ohne postId, ohne die DB abzufragen', async () => {
    // Review-Fund: seit dem artikelweisen Index ist "der" pending-Job ohne
    // postId nicht mehr eindeutig — eine Fallback-Abfrage ohne Filter koennte
    // sonst den Job eines FREMDEN Artikels liefern (genau der Fund, der
    // diesen Umbau ausgeloest hat).
    const { getJobStatus } = await import('@/lib/glossary/jobs/service')

    const job = await getJobStatus(client, 'pending')

    expect(job).toBeNull()
    expect(state.chains['glossary_jobs']).toBeUndefined()
  })

  it('filtert nach postId, wenn ein offener pending-Job angefragt wird', async () => {
    const { getJobStatus } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: { ...JOB, kind: 'pending', status: 'processing' }, error: null }]

    const job = await getJobStatus(client, 'pending', 'p1')

    expect(job?.status).toBe('processing')
    expect(state.chains['glossary_jobs'][0].eq).toHaveBeenCalledWith('params->>postId', 'p1')
  })

  it('filtert auch im Fallback auf den juengsten abgeschlossenen Job nach postId', async () => {
    const { getJobStatus } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [
      { data: null, error: null },
      { data: { ...JOB, kind: 'pending', status: 'done' }, error: null },
    ]

    const job = await getJobStatus(client, 'pending', 'p1')

    expect(job?.status).toBe('done')
    expect(state.chains['glossary_jobs'][1].eq).toHaveBeenCalledWith('params->>postId', 'p1')
  })
})

describe('getNextOpenJob', () => {
  // Jeder Aufruf macht seit dem Serialisierungs-Fix (Befund N1) ZWEI Queries:
  // zuerst den kind-uebergreifenden Lease-Check, dann erst die eigentliche
  // Auswahl. Ohne einen zweiten Queue-Eintrag faellt die zweite Query auf
  // state.fallback ({data:null, error:null}) zurueck — fuer die Tests unten
  // unschaedlich, aber die Chain-Indizes verschieben sich dadurch auf [1].
  it('filtert Jobs mit frischem Lease heraus', async () => {
    // Der Filter muss "last_advanced_at ist null ODER aelter als die
    // Lease-Grenze" ausdruecken, sonst greift ein zweiter Minutentick in einen
    // laufenden Job.
    const { getNextOpenJob, LEASE_STALE_MS } = await import('@/lib/glossary/jobs/service')
    const now = Date.parse('2026-08-05T12:00:00Z')
    // Erste Antwort: Lease-Check ("kein anderer Job aktiv"). Zweite: die
    // eigentliche Auswahl-Query, die hier geprueft wird.
    state.queues['glossary_jobs'] = [{ data: null, error: null }, { data: null, error: null }]

    await getNextOpenJob(client, now)

    const chain = state.chains['glossary_jobs'][1]
    const expected = new Date(now - LEASE_STALE_MS).toISOString()
    expect(chain.or).toHaveBeenCalledWith(
      `last_advanced_at.is.null,last_advanced_at.lt.${expected}`,
    )
    expect(chain.in).toHaveBeenCalledWith('status', ['pending', 'processing'])
  })

  it('nimmt den aeltesten offenen Job', async () => {
    const { getNextOpenJob } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [
      { data: null, error: null },
      { data: { ...JOB, id: 'alt' }, error: null },
    ]

    const job = await getNextOpenJob(client, Date.parse('2026-08-05T12:00:00Z'))

    expect(job?.id).toBe('alt')
    expect(state.chains['glossary_jobs'][1].order).toHaveBeenCalledWith('created_at', { ascending: true })
  })

  it('setzt den Tick aus, wenn irgendein offener Job — gleich welcher Art — ein frisches Lease haelt', async () => {
    // Befund N1: generate und relink teilen sich denselben JSONB-Zustand
    // (settings.glossary_crawl_state). Liefen beide gleichzeitig, wuerde
    // relink den Fortschritt von generate ueberschreiben, waehrend dessen
    // Modell-Ergebnis noch nicht zurueckgeschrieben ist — ein Livelock, der
    // nie eskaliert. Deshalb genau EIN Lexikonlauf gleichzeitig, quer ueber
    // alle Arten: haelt irgendein offener Job schon ein frisches Lease,
    // liefert diese Funktion null, OHNE die Haupt-Query ueberhaupt zu stellen.
    const { getNextOpenJob } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: { id: 'anderer-job' }, error: null }]

    const job = await getNextOpenJob(client, Date.parse('2026-08-05T12:00:00Z'))

    expect(job).toBeNull()
    expect(state.chains['glossary_jobs'].length).toBe(1)
  })

  it('loggt einen Lesefehler und liefert null, statt ihn stillschweigend zu verwerfen', async () => {
    // Befund N4: bis die Migration angewendet ist, waere eine fehlende Tabelle
    // sonst von "gerade nichts zu tun" nicht zu unterscheiden — der
    // Minutentakt-Cron antwortet dauerhaft lautlos {ok:true, idle:true}.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getNextOpenJob } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [
      { data: null, error: { message: 'relation "glossary_jobs" does not exist' } },
    ]

    const job = await getNextOpenJob(client, Date.parse('2026-08-05T12:00:00Z'))

    expect(job).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('getNextOpenJob'),
      expect.stringContaining('does not exist'),
    )
    errorSpy.mockRestore()
  })
})

describe('stampLease', () => {
  it('setzt processing und stempelt last_advanced_at', async () => {
    // Die Cron-Route ruft dies direkt nach getNextOpenJob: der Job muss noch
    // vor der ersten Arbeitseinheit als "in Arbeit" markiert sein, sonst
    // koennte ein zweiter Minutentick denselben Job innerhalb der Lease-Frist
    // fuer sich beanspruchen.
    const { stampLease } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: null, error: null }]

    await stampLease(client, 'j1')

    const chain = state.chains['glossary_jobs'][0]
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'processing', last_advanced_at: expect.any(String) }),
    )
    expect(chain.eq).toHaveBeenCalledWith('id', 'j1')
  })
})

describe('releaseLease', () => {
  it('setzt last_advanced_at auf null, ohne den Status anzufassen', async () => {
    // advanceJob ruft dies, wenn ein Tick ohne Abschluss endet (Budget oder
    // Ueberlast unter dem Attempts-Limit): sonst bliebe der zuletzt von
    // appendLog gestempelte Wert stehen, und getNextOpenJob wuerde den Job erst
    // nach LEASE_STALE_MS (6 Minuten) wieder aufgreifen statt im naechsten
    // Minutentick.
    const { releaseLease } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: null, error: null }]

    await releaseLease(client, 'j1')

    const chain = state.chains['glossary_jobs'][0]
    expect(chain.update).toHaveBeenCalledWith({ last_advanced_at: null })
    expect(chain.eq).toHaveBeenCalledWith('id', 'j1')
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
