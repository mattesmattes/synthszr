/**
 * Minuten-Cron der Artikel-Jobs (2026-10-19): hängt Phasen innerhalb eines
 * Aufrufs aneinander, solange Zeitbudget bleibt — der Browser treibt nicht mehr,
 * und ein Tick je Phase hieße bis zu einer Minute Leerlauf nach jeder Phase.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({ verifyCronAuth: vi.fn(), advance: vi.fn() }))
vi.mock('@/lib/security/cron-auth', () => ({ verifyCronAuth: mocks.verifyCronAuth }))
vi.mock('@/lib/article-jobs/service', () => ({ advanceArticleJob: mocks.advance }))

import { GET } from '@/app/api/cron/article-jobs/route'

const req = () => new Request('https://x/api/cron/article-jobs', { headers: { authorization: 'Bearer t' } }) as any

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyCronAuth.mockReturnValue({ authorized: true })
})
afterEach(() => vi.useRealTimers())

describe('GET /api/cron/article-jobs', () => {
  it('haengt Phasen aneinander, bis der Job fertig ist', async () => {
    mocks.advance
      .mockResolvedValueOnce('planned').mockResolvedValueOnce('writing_progress').mockResolvedValueOnce('writing_done')
      .mockResolvedValueOnce('finalized').mockResolvedValueOnce('lexicon_done')
    const res = await GET(req())
    const body = await res.json()
    expect(mocks.advance).toHaveBeenCalledTimes(5)
    expect(body).toEqual({ ok: true, result: 'lexicon_done', results: ['planned', 'writing_progress', 'writing_done', 'finalized', 'lexicon_done'] })
  })

  it('stoppt sofort bei no_job, claimed_elsewhere und tick_error', async () => {
    for (const r of ['no_job', 'claimed_elsewhere', 'tick_error']) {
      mocks.advance.mockReset(); mocks.advance.mockResolvedValue(r)
      const res = await GET(req())
      expect(mocks.advance).toHaveBeenCalledTimes(1)
      expect((await res.json()).result).toBe(r)
    }
  })

  it('startet nach dem Zeitbudget keine weitere Phase', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T10:00:00Z'))
    mocks.advance.mockImplementation(async () => { vi.setSystemTime(Date.now() + 250_000); return 'writing_progress' })
    await GET(req())
    expect(mocks.advance).toHaveBeenCalledTimes(1)
  })

  it('401 ohne Cron-Auth', async () => {
    mocks.verifyCronAuth.mockReturnValue({ authorized: false })
    expect((await GET(req())).status).toBe(401)
    expect(mocks.advance).not.toHaveBeenCalled()
  })
})
