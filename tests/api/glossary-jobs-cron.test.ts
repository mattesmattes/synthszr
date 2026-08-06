/**
 * Minutentakt-Cron der Lexikon-Jobs.
 *
 * Zwei Befunde des Abschluss-Reviews vom 2026-08-05:
 * - N5: kein Test deckte die Autorisierung ab. Das Plan-Sample hatte an
 *   genau dieser Stelle `if (!verifyCronAuth(request))` — verifyCronAuth
 *   liefert ein Objekt ({authorized, method}), das IMMER truthy ist, die
 *   Pruefung waere wirkungslos gewesen und der Endpunkt offen fuer jeden, der
 *   Modellkosten ausloesen will. Der Code prueft heute richtig `.authorized`;
 *   dieser Test haelt die Regression fest.
 * - N2: eine Exception, die advanceJob VERLAESST (z. B. relinkNextBatch ohne
 *   ladbare Begriffsliste), zaehlte bisher nicht in `attempts` — der Job
 *   waere alle sechs Minuten wieder aufgegriffen worden, fuer immer, ohne
 *   Protokollzeile und ohne je zu eskalieren.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyCronAuth: vi.fn(),
  getNextOpenJob: vi.fn(),
  stampLease: vi.fn(),
  claimJob: vi.fn(),
  appendLog: vi.fn(),
  finishJob: vi.fn(),
  setAttempts: vi.fn(),
  releaseLease: vi.fn(),
  advanceJob: vi.fn(),
}))

vi.mock('@/lib/security/cron-auth', () => ({ verifyCronAuth: mocks.verifyCronAuth }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/glossary/jobs/service', () => ({
  getNextOpenJob: mocks.getNextOpenJob,
  stampLease: mocks.stampLease,
  claimJob: mocks.claimJob,
  appendLog: mocks.appendLog,
  finishJob: mocks.finishJob,
  setAttempts: mocks.setAttempts,
  releaseLease: mocks.releaseLease,
}))
vi.mock('@/lib/glossary/jobs/advance', () => ({
  advanceJob: mocks.advanceJob,
  MAX_ATTEMPTS: 10,
  stamp: () => '10:00:00',
}))

function req() {
  return new NextRequest('https://x/api/cron/glossary-jobs')
}

describe('Tick-Zaehlung beim Aufnehmen (Timeout-Blindheit)', () => {
  // Befund 2026-08-06, in Prod 2,5 Stunden lang unbemerkt: ein Tick, der ins
  // Function-Timeout (300s) laeuft, wird von der Plattform hart beendet. Er
  // kann danach NICHTS mehr schreiben — kein attempts, kein Protokoll, keinen
  // Fehlerstatus. Der catch-Pfad unten wird ebenfalls nie erreicht. Solange
  // nur der catch und der Ueberlast-Zweig zaehlen, eskaliert ein gekillter
  // Tick also NIE: der naechste Cron nimmt den Job nach Lease-Ablauf wieder
  // auf, fuer immer, und im Panel steht unveraendert "Wartet.".
  // Deshalb wird der Versuch VOR der Arbeit gezaehlt.
  it('stempelt den Versuch, bevor advanceJob laeuft', async () => {
    mocks.verifyCronAuth.mockReturnValue({ authorized: true, method: 'bearer' })
    mocks.getNextOpenJob.mockResolvedValue({ ...JOB, attempts: 2 })
    mocks.advanceJob.mockResolvedValue({ units: 1, finished: false })

    const { GET } = await import('@/app/api/cron/glossary-jobs/route')
    await GET(req())

    expect(mocks.claimJob).toHaveBeenCalledWith({}, JOB.id, 3)
    const claimOrder = mocks.claimJob.mock.invocationCallOrder[0]
    const advanceOrder = mocks.advanceJob.mock.invocationCallOrder[0]
    expect(claimOrder).toBeLessThan(advanceOrder)
  })

  it('gibt einen Job auf, der das Limit erreicht hat, ohne ihn noch einmal laufen zu lassen', async () => {
    // Das ist der Ausweg aus der Endlosschleife: nach MAX_ATTEMPTS gekillten
    // Ticks endet der Job als 'error' — sichtbar im Panel, statt still weiter
    // Geld zu verbrennen.
    mocks.verifyCronAuth.mockReturnValue({ authorized: true, method: 'bearer' })
    mocks.getNextOpenJob.mockResolvedValue({ ...JOB, attempts: 10 })

    const { GET } = await import('@/app/api/cron/glossary-jobs/route')
    await GET(req())

    expect(mocks.advanceJob).not.toHaveBeenCalled()
    expect(mocks.finishJob).toHaveBeenCalledWith({}, JOB.id, 'error', expect.stringContaining('10'))
  })
})

const JOB = {
  id: 'j1', kind: 'relink' as const, status: 'processing' as const, total: null,
  done_count: 3, log: [], cancel_requested: false, last_advanced_at: null,
  attempts: 2, params: {}, error_message: null, created_at: '', finished_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyCronAuth.mockReturnValue({ authorized: true, method: 'bearer' })
})

describe('GET /api/cron/glossary-jobs — Autorisierung (Befund N5)', () => {
  it('lehnt ohne gueltige Cron-Auth mit 401 ab, ohne einen Job anzufassen', async () => {
    mocks.verifyCronAuth.mockReturnValue({ authorized: false, method: 'none' })
    const { GET } = await import('@/app/api/cron/glossary-jobs/route')

    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(mocks.getNextOpenJob).not.toHaveBeenCalled()
    expect(mocks.advanceJob).not.toHaveBeenCalled()
  })
})

describe('GET /api/cron/glossary-jobs — Fehler-Eskalation (Befund N2)', () => {
  it('zaehlt attempts hoch, protokolliert und antwortet ok:false, wenn advanceJob eine Exception wirft', async () => {
    mocks.getNextOpenJob.mockResolvedValue({ ...JOB })
    mocks.advanceJob.mockRejectedValue(new Error('Begriffsliste nicht ladbar'))

    const { GET } = await import('@/app/api/cron/glossary-jobs/route')
    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(mocks.appendLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'j1' }),
      [expect.objectContaining({ ok: false, text: expect.stringContaining('Begriffsliste nicht ladbar') })],
      0,
    )
    // Die Zaehlung ist seit 2026-08-06 an den Tick-START verlagert (claimJob),
    // damit auch ein ins Timeout gelaufener Tick zaehlt — der kann selbst nichts
    // mehr schreiben. Der catch-Pfad zaehlt deshalb NICHT mehr zusaetzlich;
    // die Eigenschaft aus Befund N2 (eine Exception bleibt nicht ungezaehlt)
    // ist dadurch erfuellt, nur an anderer Stelle.
    expect(mocks.claimJob).toHaveBeenCalledWith(expect.anything(), 'j1', 3)
    expect(mocks.setAttempts).not.toHaveBeenCalled()
    expect(mocks.releaseLease).toHaveBeenCalledWith(expect.anything(), 'j1')
    expect(mocks.finishJob).not.toHaveBeenCalled()
  })

  it('laesst den Zaehler beim zehnten Fehlschlag stehen — der naechste Tick gibt auf', async () => {
    // Bei attempts=9 laeuft der zehnte Versuch: claimJob stempelt 10, die
    // Exception wird protokolliert, das Lease wird frei. Aufgegeben wird beim
    // ELFTEN Aufnehmen (Test oben: attempts=10 → finishJob('error') ohne
    // advanceJob). So zaehlt jeder Tick-Start genau einmal, egal ob er mit
    // einer Exception endet oder von der Plattform hart beendet wird.
    mocks.getNextOpenJob.mockResolvedValue({ ...JOB, attempts: 9 })
    mocks.advanceJob.mockRejectedValue(new Error('Upsert fehlgeschlagen'))

    const { GET } = await import('@/app/api/cron/glossary-jobs/route')
    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(mocks.claimJob).toHaveBeenCalledWith(expect.anything(), 'j1', 10)
    expect(mocks.finishJob).not.toHaveBeenCalled()
    expect(mocks.releaseLease).toHaveBeenCalledWith(expect.anything(), 'j1')
  })
})
