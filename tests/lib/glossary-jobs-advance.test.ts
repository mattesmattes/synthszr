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
  relinkTranslations: vi.fn(),
  pendingUnit: vi.fn(),
  appendLog: vi.fn(),
  finishJob: vi.fn(),
  setAttempts: vi.fn(),
  stampLease: vi.fn(),
  releaseLease: vi.fn(),
  readCancelRequested: vi.fn(),
}))

vi.mock('@/lib/glossary/crawl', () => ({
  generateCandidates: mocks.generate,
  generateMissingIllustrations: mocks.images,
  relinkNextBatch: mocks.relink,
  relinkTranslationsNextBatch: mocks.relinkTranslations,
}))
vi.mock('@/lib/glossary/pending-run', () => ({
  runPendingUnit: mocks.pendingUnit,
}))
vi.mock('@/lib/glossary/jobs/service', () => ({
  appendLog: mocks.appendLog,
  finishJob: mocks.finishJob,
  setAttempts: mocks.setAttempts,
  stampLease: mocks.stampLease,
  releaseLease: mocks.releaseLease,
  readCancelRequested: mocks.readCancelRequested,
}))

const client = {} as any
const JOB = {
  id: 'j1', kind: 'generate' as const, status: 'processing' as const, total: 10,
  done_count: 0, log: [], cancel_requested: false, last_advanced_at: null,
  attempts: 0, params: {}, error_message: null, created_at: '', finished_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readCancelRequested.mockResolvedValue(false)
})

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

  it('rechnet mit der LANGSAMSTEN Einheit, nicht der schnellsten', async () => {
    // Deckt den Math.max-Zweig ab: ein Math.min waere von allen anderen Tests
    // unbemerkt geblieben. Erste Einheit 10s, zweite 200s — danach darf keine
    // dritte mehr starten, weil 210 + 200 ueber dem 240s-Budget liegt. Mit
    // Math.min waere slowestMs 10s und der Tick haette weitergemacht, direkt in
    // das Function-Timeout hinein.
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    let t = 0
    const durations = [10_000, 200_000, 10_000, 10_000]
    let call = 0
    mocks.generate.mockImplementation(async () => {
      t += durations[Math.min(call, durations.length - 1)]
      call++
      return ONE_GENERATED
    })

    const res = await advanceJob(client, { ...JOB }, { now: () => t, budgetMs: 240_000 })

    expect(res.units).toBe(2)
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

  it('eskaliert bei Ueberlast NICHT selbst — nur Tick beenden, die Cron-Route gibt auf', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.generate.mockImplementation(async () => {
      clock.advance()
      return { generated: [], failed: [], retryable: ['Transformer'], alreadyExisting: [] }
    })

    const res = await advanceJob(client, { ...JOB, attempts: 9 }, { now: clock.now, budgetMs: 240_000 })

    expect(res.finished).toBe(false)
    expect(mocks.finishJob).not.toHaveBeenCalled()
    expect(mocks.releaseLease).toHaveBeenCalledWith(client, 'j1')
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
    expect(mocks.setAttempts).not.toHaveBeenCalled()
    expect(mocks.finishJob).not.toHaveBeenCalled()
    // Der naechste Cron soll den Job in der naechsten Minute wieder aufgreifen,
    // nicht erst nach LEASE_STALE_MS — daher muss das Lease hier frei werden.
    expect(mocks.releaseLease).toHaveBeenCalledWith(client, 'j1')
  })

  it('bricht MITTEN im Tick ab, wenn der Abbruch waehrenddessen angefordert wird', async () => {
    // Vorher wurde cancel_requested nur aus dem job-Objekt gelesen, das der Tick
    // beim Start bekommen hat — ein Abbruch waehrend eines laufenden Ticks griff
    // deshalb erst beim naechsten, also bis zu eine Minute (und eine volle
    // Arbeitseinheit) spaeter. Bei einem Begriffslauf sind das 45-110s, in denen
    // der Knopf gedrueckt aussieht und trotzdem weiter Geld ausgegeben wird.
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.generate.mockImplementation(async () => { clock.advance(); return ONE_GENERATED })
    // Die erste Runde liest das Flag noch aus dem uebergebenen Job (false), die
    // DB wird erst VOR der zweiten Einheit befragt — dort meldet sie den
    // Abbruchwunsch, der Tick endet also nach genau einer Einheit.
    mocks.readCancelRequested.mockResolvedValue(true)

    const res = await advanceJob(client, { ...JOB }, { now: clock.now, budgetMs: 240_000 })

    expect(res.units).toBe(1)
    expect(mocks.finishJob).toHaveBeenCalledWith(client, 'j1', 'cancelled')
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

  it('translations: verlinkt uebersetzte Artikel nach und endet, wenn nichts mehr offen ist', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.relinkTranslations.mockImplementation(async () => {
      clock.advance()
      return { linked: ['t1', 't2'], unchanged: 3, remaining: 0, cursor: null }
    })

    const res = await advanceJob(
      client, { ...JOB, kind: 'translations' }, { now: clock.now, budgetMs: 240_000 },
    )

    expect(mocks.relinkTranslations).toHaveBeenCalledWith(client)
    expect(res.finished).toBe(true)
    expect(mocks.finishJob).toHaveBeenCalledWith(client, JOB.id, 'done')
  })

  it('translations: erkennt Stillstand als Ueberlast, statt das Budget zu verbrennen', async () => {
    // Gleiche Begruendung wie bei images/relink: das Ergebnis hat kein
    // retryable-Signal. Ohne diese Erkennung liefe derselbe Batch (gleicher
    // Cursor) im selben Tick immer wieder, bis 240s aufgebraucht sind.
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.relinkTranslations.mockImplementation(async () => {
      clock.advance()
      return { linked: [], unchanged: 0, remaining: 5, cursor: 'tc1' }
    })

    await advanceJob(
      client, { ...JOB, kind: 'translations' }, { now: clock.now, budgetMs: 240_000 },
    )

    expect(mocks.relinkTranslations).toHaveBeenCalledTimes(1)
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
    expect(mocks.setAttempts).not.toHaveBeenCalled()
  })

  it('images: eskaliert nicht selbst, beendet nur den Tick', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.images.mockImplementation(async () => {
      clock.advance()
      return { done: [], failed: ['broken-term'], remaining: 3 }
    })

    const res = await advanceJob(
      client, { ...JOB, kind: 'images', attempts: 9 }, { now: clock.now, budgetMs: 240_000 },
    )

    expect(res.finished).toBe(false)
    expect(mocks.finishJob).not.toHaveBeenCalled()
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
    expect(mocks.setAttempts).not.toHaveBeenCalled()
  })

  it('relink: ein Durchgang ohne Treffer, aber mit gepruefften Artikeln ist FORTSCHRITT, keine Ueberlast', async () => {
    // unchanged > 0 heisst: der Batch hat Artikel geprueft und keinen Begriff
    // gefunden — das ist der Normalfall gegen Ende eines Laufs, kein
    // Fehlschlag. Ohne diesen Test wuerde eine Verwechslung mit dem
    // Ueberlast-Zweig (linked leer UND unchanged leer) nicht auffallen, und
    // jeder solche Tick endete nach einer Einheit statt das Budget zu nutzen.
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.relink.mockImplementation(async () => {
      clock.advance()
      return { linked: [], unchanged: 25, remaining: 100, cursor: 'c5' }
    })

    const res = await advanceJob(
      client, { ...JOB, kind: 'relink' }, { now: clock.now, budgetMs: 240_000 },
    )

    // Kein Abbruch nach einer Einheit: das Budget wird ausgeschoepft.
    expect(res.units).toBeGreaterThan(1)
    expect(mocks.finishJob).not.toHaveBeenCalled()
  })

  it('relink: eskaliert nicht selbst, beendet nur den Tick', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.relink.mockImplementation(async () => {
      clock.advance()
      return { linked: [], unchanged: 0, remaining: 5, cursor: 'abc' }
    })

    const res = await advanceJob(
      client, { ...JOB, kind: 'relink', attempts: 9 }, { now: clock.now, budgetMs: 240_000 },
    )

    expect(res.finished).toBe(false)
    expect(mocks.finishJob).not.toHaveBeenCalled()
  })
})

describe('advanceJob (pending)', () => {
  const PENDING_JOB = {
    ...JOB, kind: 'pending' as const,
    params: { postId: 'p1', confirmedSlugs: ['slop', 'reward-hacking'] },
  }

  it('reicht postId und confirmedSlugs aus params an runPendingUnit durch', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.pendingUnit.mockImplementation(async () => {
      clock.advance()
      return { generated: ['Slop'], failed: [], remaining: 1, linked: 0 }
    })

    await advanceJob(client, { ...PENDING_JOB }, { now: clock.now, budgetMs: 240_000 })

    expect(mocks.pendingUnit).toHaveBeenCalledWith(client, 'p1', ['slop', 'reward-hacking'])
  })

  it('protokolliert erzeugte und fehlgeschlagene Begriffe und zaehlt done_count hoch', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    // Beide mockImplementationOnce MUESSEN in diesem Test verbraucht werden —
    // sonst leakt der zweite Rueckgabewert in den naechsten Test (vi.clearAllMocks
    // in beforeEach loescht nur Aufrufdaten, nicht die Once-Warteschlange).
    mocks.pendingUnit
      .mockImplementationOnce(async () => { clock.advance(); return { generated: ['Slop'], failed: [], remaining: 1, linked: 0 } })
      .mockImplementationOnce(async () => { clock.advance(); return { generated: [], failed: ['Reward Hacking'], remaining: 1, linked: 0 } })

    const res = await advanceJob(client, { ...PENDING_JOB, attempts: 0 }, { now: clock.now, budgetMs: 240_000 })

    expect(mocks.appendLog).toHaveBeenCalledWith(
      client, expect.anything(),
      [{ at: expect.any(String), text: 'Slop — erzeugt', ok: true }],
      1,
    )
    expect(mocks.appendLog).toHaveBeenCalledWith(
      client, expect.anything(),
      [{ at: expect.any(String), text: 'Reward Hacking — fehlgeschlagen, siehe Server-Log', ok: false }],
      0,
    )
    expect(res.units).toBe(2)
    // Die zweite Einheit ist Ueberlast (nichts erzeugt, aber noch offen) —
    // der Tick endet dort, ohne den Job abzuschliessen.
    expect(res.finished).toBe(false)
  })

  it('endet den Job (exhausted), wenn nach der Einheit nichts mehr offen ist', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.pendingUnit.mockImplementation(async () => {
      clock.advance()
      return { generated: ['Reward Hacking'], failed: [], remaining: 0, linked: 2 }
    })

    const res = await advanceJob(client, { ...PENDING_JOB }, { now: clock.now, budgetMs: 240_000 })

    expect(res.finished).toBe(true)
    expect(mocks.finishJob).toHaveBeenCalledWith(client, 'j1', 'done')
  })

  it('behandelt "nichts erzeugt, aber noch offen" als Ueberlast (Fortschritt-Null-Erkennung)', async () => {
    // Gleiche Begruendung wie bei images/relink: ohne dieses Signal wuerde ein
    // dauerhaft scheiternder Kandidat denselben Versuch wiederholen, bis das
    // ganze 240s-Budget verbraucht ist, ohne je zu eskalieren.
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.pendingUnit.mockImplementation(async () => {
      clock.advance()
      return { generated: [], failed: ['Kaputt'], remaining: 3, linked: 0 }
    })

    const res = await advanceJob(client, { ...PENDING_JOB }, { now: clock.now, budgetMs: 240_000 })

    expect(mocks.pendingUnit).toHaveBeenCalledTimes(1)
    expect(res.finished).toBe(false)
    expect(mocks.setAttempts).not.toHaveBeenCalled()
    expect(mocks.releaseLease).toHaveBeenCalledWith(client, 'j1')
  })

  it('eskaliert bei Ueberlast NICHT selbst — nur Tick beenden, die Cron-Route gibt auf', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.pendingUnit.mockImplementation(async () => {
      clock.advance()
      return { generated: [], failed: ['Kaputt'], remaining: 3, linked: 0 }
    })

    const res = await advanceJob(client, { ...PENDING_JOB, attempts: 9 }, { now: clock.now, budgetMs: 240_000 })

    expect(res.finished).toBe(false)
    expect(mocks.finishJob).not.toHaveBeenCalled()
  })

  it('beendet den Job SOFORT als error, wenn beim Abschluss nicht alle bestaetigten Slugs veroeffentlicht wurden', async () => {
    // Review-Fund: ein 'done' hier waere ein persistenter gruener Endzustand,
    // den niemand anzweifelt, obwohl ein Begriff nie veroeffentlicht wurde.
    // Das darf NICHT ueber die 10-Versuche-Eskalation (overloaded) laufen —
    // ein Retry wuerde denselben deterministischen Fehlschlag (z. B. hidden-
    // Status) nur verzoegert wiederholen.
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.pendingUnit.mockImplementation(async () => {
      clock.advance()
      return { generated: [], failed: [], remaining: 0, linked: 1, publishFailed: ['Reward Hacking'] }
    })

    const res = await advanceJob(client, { ...PENDING_JOB, attempts: 0 }, { now: clock.now, budgetMs: 240_000 })

    expect(res.finished).toBe(true)
    // Der fatal-Pfad ist von der Zaehler-Verlagerung UNBERUEHRT: er eskaliert
    // weiterhin sofort und selbst, weil der Fehler deterministisch ist (ein
    // bestaetigter Slug ist hidden) — ein Retry wuerde ihn nur verzoegert
    // wiederholen. Nur der Ueberlast-Pfad zaehlt nicht mehr selbst.
    expect(mocks.finishJob).toHaveBeenCalledWith(
      client, 'j1', 'error', expect.stringContaining('Veröffentlichung unvollständig'),
    )
    expect(mocks.finishJob).not.toHaveBeenCalledWith(client, 'j1', 'done')
    // Kein Retry-Pfad: weder Ueberlast-Zaehler noch Lease-Freigabe fuer einen
    // weiteren Versuch — der Job ist sofort und endgueltig fertig.
    expect(mocks.setAttempts).not.toHaveBeenCalled()
    expect(mocks.releaseLease).not.toHaveBeenCalled()
    // Die ok:false-Protokollzeile muss den Betreiber informieren, dass etwas
    // als Entwurf liegen bleibt.
    expect(mocks.appendLog).toHaveBeenCalledWith(
      client, expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ ok: false, text: expect.stringContaining('konnten nicht veröffentlicht werden') }),
      ]),
      0,
    )
  })

  it('protokolliert die Abschlusszeile ohne die "verlinkt"-Zusage, wenn alles veroeffentlicht wurde', async () => {
    // Kosmetik-Fund: applyGlossaryConfirmation kann die Text-Injektion
    // uebersprungen haben (Parse-Fehler, terms===null) — "veroeffentlicht UND
    // verlinkt" waere dann eine Behauptung, die pending-run.ts gar nicht
    // garantieren kann.
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.pendingUnit.mockImplementation(async () => {
      clock.advance()
      return { generated: ['Slop'], failed: [], remaining: 0, linked: 1 }
    })

    await advanceJob(client, { ...PENDING_JOB }, { now: clock.now, budgetMs: 240_000 })

    expect(mocks.appendLog).toHaveBeenCalledWith(
      client, expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ ok: true, text: '1 Begriffe veröffentlicht' }),
      ]),
      1,
    )
  })
})
