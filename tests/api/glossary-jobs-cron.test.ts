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
    expect(mocks.setAttempts).toHaveBeenCalledWith(expect.anything(), 'j1', 3)
    expect(mocks.releaseLease).toHaveBeenCalledWith(expect.anything(), 'j1')
    expect(mocks.finishJob).not.toHaveBeenCalled()
  })

  it('gibt nach MAX_ATTEMPTS auf und setzt den Job auf error, statt fuer immer alle sechs Minuten neu zu versuchen', async () => {
    mocks.getNextOpenJob.mockResolvedValue({ ...JOB, attempts: 9 })
    mocks.advanceJob.mockRejectedValue(new Error('Upsert fehlgeschlagen'))

    const { GET } = await import('@/app/api/cron/glossary-jobs/route')
    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(mocks.finishJob).toHaveBeenCalledWith(
      expect.anything(), 'j1', 'error', expect.stringContaining('Upsert fehlgeschlagen'),
    )
    // Der Job ist mit 'error' nicht mehr offen — eine zusaetzliche
    // Lease-Freigabe waere hier ueberfluessig (gleiche Logik wie advanceJob).
    expect(mocks.releaseLease).not.toHaveBeenCalled()
  })
})
