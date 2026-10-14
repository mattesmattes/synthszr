/**
 * Minuten-Cron der Morgenkonferenz (Task 12, Anhang A §3 Step 1): Kickoff zum
 * festen UTC-Slot, Rekonziliation des Vortags (Vorrang vor Advance) und eine
 * Arbeitseinheit mit Lease. Muster: tests/api/glossary-jobs-route.test.ts
 * (vi.hoisted-Mocks, ein Request-Factory, beforeEach mit vi.clearAllMocks).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// WARUM ohne Default-Implementierung (anders als im Brief-Entwurf): ein
// `vi.fn(async () => [])` legt den Mock-Typ auf GENAU diese Rueckgabeform
// fest — ein spaeteres `mockResolvedValueOnce({ id: 'r', ... })` mit anderer
// Form ist dann ein Typfehler (tsc: "not assignable to type 'never'").
// Gleiches Muster wie tests/api/glossary-jobs-cron.test.ts: leere `vi.fn()`,
// Defaults kommen unten in beforeEach.
const m = vi.hoisted(() => ({
  verifyCronAuth: vi.fn(),
  loadCurationSettings: vi.fn(),
  createRun: vi.fn(),
  spentTodayUsd: vi.fn(),
  getRunsToReconcile: vi.fn(),
  reconcileRun: vi.fn(),
  getNextOpenRun: vi.fn(),
  claimRun: vi.fn(),
  releaseLease: vi.fn(),
  finishRun: vi.fn(),
  appendRunLog: vi.fn(),
  advanceRun: vi.fn(),
  listTodayRuns: vi.fn(),
  markReconciled: vi.fn(),
}))

vi.mock('@/lib/security/cron-auth', () => ({ verifyCronAuth: m.verifyCronAuth }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/curation/service', async (orig) => ({
  ...(await orig() as object),
  loadCurationSettings: m.loadCurationSettings,
  createRun: m.createRun,
  spentTodayUsd: m.spentTodayUsd,
  getRunsToReconcile: m.getRunsToReconcile,
  getNextOpenRun: m.getNextOpenRun,
  claimRun: m.claimRun,
  releaseLease: m.releaseLease,
  finishRun: m.finishRun,
  appendRunLog: m.appendRunLog,
  listRuns: m.listTodayRuns,
  markReconciled: m.markReconciled,
}))
// WARUM nicht wie im Brief-Entwurf ein voller Ersatz des Moduls: run.ts
// exportiert neben advanceRun auch TICK_BUDGET_MS, das die Route live
// einliest (budgetMs: TICK_BUDGET_MS) — ein Vollersatz liesse den Zugriff auf
// einen nicht gemockten Export ins Leere laufen (Vitest wirft dann statt
// undefined zu liefern) und der Erfolgspfad der Route landete faelschlich im
// catch-Zweig. Gleiches Muster wie beim Service-Mock oben: nur advanceRun
// wird ersetzt, der Rest (inkl. TICK_BUDGET_MS) bleibt echt.
vi.mock('@/lib/curation/run', async (orig) => ({ ...(await orig() as object), advanceRun: m.advanceRun }))
vi.mock('@/lib/curation/reconcile', () => ({ reconcileRun: m.reconcileRun }))
vi.mock('@/lib/ai/call', () => ({ createCaller: () => ({ callTool: vi.fn(), modelFor: async (u: string) => `model-${u}` }) }))
vi.mock('@/lib/embeddings/generator', () => ({ generateEmbeddings: vi.fn() }))

import { DEFAULT_CURATION_SETTINGS } from '@/lib/curation/types'

const req = () => new Request('https://x/api/cron/curation-jobs') as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-15T04:26:00.000Z'))
  m.verifyCronAuth.mockReturnValue({ authorized: true })
  m.loadCurationSettings.mockResolvedValue({ ...DEFAULT_CURATION_SETTINGS, shadow_enabled: true })
  m.spentTodayUsd.mockResolvedValue(0)
  m.getRunsToReconcile.mockResolvedValue([])
  m.getNextOpenRun.mockResolvedValue(null)
  m.listTodayRuns.mockResolvedValue([])
})

describe('GET /api/cron/curation-jobs', () => {
  it('401 ohne Cron-Auth', async () => {
    m.verifyCronAuth.mockReturnValueOnce({ authorized: false })
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    expect((await GET(req())).status).toBe(401)
  })

  it('Kickoff legt den Tages-Run an, wenn shadow_enabled, Zeit erreicht und kein Run fuer heute', async () => {
    m.createRun.mockResolvedValue({ id: 'r', status: 'pending' })
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    const body = await (await GET(req())).json()
    expect(m.createRun).toHaveBeenCalledWith({}, expect.objectContaining({
      day: '2026-10-15', mode: 'shadow', asof: '2026-10-15T04:25:00.000Z', brief_mode: 'full', budget_usd: 4,
      models: { scout: 'model-curation_scout', editor: 'model-curation_editor', critic: 'model-curation_critic' },
    }))
    expect(body.kickoff).toBe('r')
  })

  it('kein Kickoff bei shadow_enabled=false, vor der Zeit oder bei erschoepfter Tageskappe', async () => {
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    m.loadCurationSettings.mockResolvedValueOnce({ ...DEFAULT_CURATION_SETTINGS, shadow_enabled: false })
    await GET(req())
    expect(m.createRun).not.toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-10-15T04:20:00.000Z'))
    await GET(req())
    expect(m.createRun).not.toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-10-15T04:30:00.000Z'))
    m.spentTodayUsd.mockResolvedValueOnce(12)
    await GET(req())
    expect(m.createRun).not.toHaveBeenCalled()
  })

  it('Rekonziliation hat Vorrang vor advance; naechster Tick danach idle', async () => {
    m.getRunsToReconcile.mockResolvedValueOnce([{ id: 'old', asof: '2026-10-14T04:25:00.000Z', log: [] }])
    m.reconcileRun.mockResolvedValue({ matched: { post_id: 'p', job_id: 'j', attribution: 'job' }, metrics: {} })
    m.listTodayRuns.mockResolvedValue([{ id: 'today', day: '2026-10-15', mode: 'shadow', status: 'done' }])
    const { GET } = await import('@/app/api/cron/curation-jobs/route')

    const body = await (await GET(req())).json()
    expect(body.reconciled).toBe('old')
    expect(m.advanceRun).not.toHaveBeenCalled()

    // Naechster Tick: getRunsToReconcile liefert (mockResolvedValueOnce ist
    // verbraucht) wieder den beforeEach-Default [], getNextOpenRun den
    // Default null — der Tick hat nichts mehr zu tun.
    const second = await (await GET(req())).json()
    expect(second.idle).toBe(true)
  })

  it('Rekonziliation: ein Fehler in reconcileRun setzt ok:false zusaetzlich zu reconcile_error', async () => {
    m.getRunsToReconcile.mockResolvedValueOnce([{ id: 'old', asof: '2026-10-14T04:25:00.000Z', log: [] }])
    m.reconcileRun.mockRejectedValueOnce(new Error('reconcile kaputt'))
    m.listTodayRuns.mockResolvedValue([{ id: 'today', day: '2026-10-15', mode: 'shadow', status: 'done' }])
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    const body = await (await GET(req())).json()
    expect(body.ok).toBe(false)
    expect(body.reconcile_error).toBe('reconcile kaputt')
  })

  it('R22: reconcileRun wirft → reconcile_error am Run, Advance laeuft im selben Tick weiter', async () => {
    const due = { id: 'old', asof: '2026-10-14T04:25:00.000Z', log: [] }
    m.getRunsToReconcile.mockResolvedValueOnce([due])
    m.reconcileRun.mockRejectedValueOnce(new Error('embed_failed'))
    m.listTodayRuns.mockResolvedValue([{ id: 'r', day: '2026-10-15', mode: 'shadow', status: 'processing' }])
    m.getNextOpenRun.mockResolvedValueOnce({ id: 'r', attempts: 0, log: [] })
    m.claimRun.mockResolvedValueOnce(true)
    m.advanceRun.mockResolvedValueOnce({ phase: 'finished', finished: true, note: 'done' })
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    const body = await (await GET(req())).json()
    expect(m.appendRunLog).toHaveBeenCalledWith({}, due, [expect.objectContaining({ text: expect.stringContaining('reconcile_error'), ok: false })])
    expect(m.markReconciled).not.toHaveBeenCalled()
    expect(m.advanceRun).toHaveBeenCalledTimes(1)
    expect(body.advanced).toBe('r')
    expect(body.ok).toBe(false)
    expect(body.reconcile_error).toBe('embed_failed')
  })

  it('R22: nach 3 reconcile_error-Eintraegen → markReconciled mit metrics null + reconcile_failed, kein erneuter Versuch, Advance laeuft', async () => {
    const failed = (n: number) => ({ at: `0${n}`, text: `reconcile_error: embed_failed (${n})`, ok: false })
    const due = { id: 'old', asof: '2026-10-14T04:25:00.000Z', log: [failed(1), failed(2), failed(3)] }
    m.getRunsToReconcile.mockResolvedValueOnce([due])
    m.listTodayRuns.mockResolvedValue([{ id: 'r', day: '2026-10-15', mode: 'shadow', status: 'processing' }])
    m.getNextOpenRun.mockResolvedValueOnce({ id: 'r', attempts: 0, log: [] })
    m.claimRun.mockResolvedValueOnce(true)
    m.advanceRun.mockResolvedValueOnce({ phase: 'finished', finished: true, note: 'done' })
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    const body = await (await GET(req())).json()
    expect(m.reconcileRun).not.toHaveBeenCalled()
    expect(m.markReconciled).toHaveBeenCalledWith({}, 'old', { matched_post_id: null, matched_job_id: null, metrics: null })
    expect(m.appendRunLog).toHaveBeenCalledWith({}, due, [expect.objectContaining({ text: expect.stringContaining('reconcile_failed'), ok: false })])
    expect(m.advanceRun).toHaveBeenCalledTimes(1)
    expect(body.reconcile_failed).toBe('old')
  })

  it('R22: zwei fruehere Fehlversuche + dritter Fehlschlag → nur Log, noch kein Abschluss', async () => {
    const failed = (n: number) => ({ at: `0${n}`, text: `reconcile_error: x (${n})`, ok: false })
    m.getRunsToReconcile.mockResolvedValueOnce([{ id: 'old', asof: '2026-10-14T04:25:00.000Z', log: [failed(1), failed(2)] }])
    m.reconcileRun.mockRejectedValueOnce(new Error('x'))
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    await GET(req())
    expect(m.reconcileRun).toHaveBeenCalledTimes(1)
    expect(m.markReconciled).not.toHaveBeenCalled()
    expect(m.appendRunLog).toHaveBeenCalledTimes(1)
  })

  it('advance: attempts >= MAX_ATTEMPTS → error vor der Arbeit; Exception → Log + Lease frei + ok:false', async () => {
    m.listTodayRuns.mockResolvedValue([{ id: 'r', day: '2026-10-15', mode: 'shadow', status: 'processing' }])
    m.getNextOpenRun.mockResolvedValueOnce({ id: 'r', attempts: 10, log: [] })
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    await GET(req())
    expect(m.finishRun).toHaveBeenCalledWith({}, 'r', 'error', expect.stringContaining('10'))

    m.getNextOpenRun.mockResolvedValueOnce({ id: 'r', attempts: 1, log: [] })
    m.advanceRun.mockRejectedValueOnce(new Error('kaputt'))
    const body = await (await GET(req())).json()
    expect(m.claimRun).toHaveBeenCalledWith({}, 'r', 2)
    expect(m.releaseLease).toHaveBeenCalledWith({}, 'r')
    expect(body.ok).toBe(false)
  })

  it('R10: advanceRun mit finished:false gibt die Lease frei, damit der naechste Minutentick sofort weitermacht', async () => {
    m.listTodayRuns.mockResolvedValue([{ id: 'r', day: '2026-10-15', mode: 'shadow', status: 'processing' }])
    m.getNextOpenRun.mockResolvedValueOnce({ id: 'r', attempts: 1, log: [] })
    m.advanceRun.mockResolvedValueOnce({ phase: 'compose', finished: false, note: 'compose wartet auf den naechsten Tick' })
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    const body = await (await GET(req())).json()
    expect(m.releaseLease).toHaveBeenCalledWith({}, 'r')
    expect(body.ok).toBe(true)
    expect(body.advanced).toBe('r')
    expect(body.finished).toBe(false)
  })

  it('R19: eine DB-Exception ausserhalb jeder Arbeitseinheit antwortet trotzdem 200 mit ok:false', async () => {
    m.listTodayRuns.mockResolvedValue([{ id: 'r', day: '2026-10-15', mode: 'shadow', status: 'processing' }])
    m.getNextOpenRun.mockRejectedValueOnce(new Error('db weg'))
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: false, error: 'db weg' })
  })
})
