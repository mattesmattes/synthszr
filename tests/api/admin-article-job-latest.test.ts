/**
 * Admin-API der Artikel-Jobs (2026-10-19): GET ?latest=1 liefert den juengsten
 * manuellen Job, damit die Seite „AI Artikel erstellen“ nach dem Wiederoeffnen
 * (iOS, Tab war im Hintergrund) den laufenden oder gerade fertigen Job anzeigt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ session: vi.fn(), latest: vi.fn(), status: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/ai/model-config', () => ({ getModelForUseCase: vi.fn(async () => 'claude-opus-5') }))
vi.mock('@/lib/article-jobs/service', () => ({
  createManualArticleJob: vi.fn(), advanceArticleJob: vi.fn(), getArticleJobStatus: mocks.status, getLatestManualJob: mocks.latest,
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/admin/article-job/route'

const get = (qs: string) => GET(new NextRequest(`https://x/api/admin/article-job?${qs}`))

beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ user: 'admin' }) })

describe('GET /api/admin/article-job?latest=1', () => {
  it('liefert den juengsten manuellen Job mit Status', async () => {
    const latest = { jobId: 'job-9', createdAt: '2026-10-19T05:00:00Z', status: 'processing', phase: 'writing', cursor: 3, total: 10, generatedPostId: null, error: null }
    mocks.latest.mockResolvedValue(latest)
    const res = await get('latest=1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ job: latest })
    expect(mocks.status).not.toHaveBeenCalled()
  })

  it('liefert job null, wenn es keinen gibt', async () => {
    mocks.latest.mockResolvedValue(null)
    expect(await (await get('latest=1')).json()).toEqual({ job: null })
  })

  it('401 ohne Session', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await get('latest=1')).status).toBe(401)
  })
})
