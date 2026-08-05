/**
 * Admin-Schnittstelle der Lexikon-Jobs. Der Browser darf hier nur anlegen,
 * lesen und abbrechen — getrieben wird der Lauf vom Cron.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  createOrGet: vi.fn(),
  status: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/glossary/jobs/service', () => ({
  createOrGetJob: mocks.createOrGet,
  getJobStatus: mocks.status,
  requestCancel: mocks.cancel,
}))

function req(body?: unknown, url = 'https://x/api/admin/glossary-jobs') {
  return new Request(url, {
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json' },
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: 'admin' })
})

describe('POST /api/admin/glossary-jobs', () => {
  it('lehnt ohne Session mit 401 ab', async () => {
    mocks.session.mockResolvedValue(null)
    const { POST } = await import('@/app/api/admin/glossary-jobs/route')

    const res = await POST(req({ kind: 'generate' }))

    expect(res.status).toBe(401)
    expect(mocks.createOrGet).not.toHaveBeenCalled()
  })

  it('weist eine unbekannte Art ab', async () => {
    const { POST } = await import('@/app/api/admin/glossary-jobs/route')

    const res = await POST(req({ kind: 'unsinn' }))

    expect(res.status).toBe(400)
  })

  it('legt einen Job an', async () => {
    mocks.createOrGet.mockResolvedValue({ id: 'j1', kind: 'generate', status: 'pending' })
    const { POST } = await import('@/app/api/admin/glossary-jobs/route')

    const res = await POST(req({ kind: 'generate' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.job.id).toBe('j1')
  })

  it('reicht since fuer relink als params durch', async () => {
    mocks.createOrGet.mockResolvedValue({ id: 'j2', kind: 'relink', status: 'pending' })
    const { POST } = await import('@/app/api/admin/glossary-jobs/route')

    await POST(req({ kind: 'relink', from: '2020-01-01' }))

    expect(mocks.createOrGet).toHaveBeenCalledWith(
      expect.anything(), 'relink', { since: '2020-01-01T00:00:00.000Z' },
    )
  })
})

describe('GET /api/admin/glossary-jobs', () => {
  it('liefert den Status der angefragten Art', async () => {
    mocks.status.mockResolvedValue({ id: 'j1', kind: 'images', status: 'processing' })
    const { GET } = await import('@/app/api/admin/glossary-jobs/route')

    const res = await GET(req(undefined, 'https://x/api/admin/glossary-jobs?kind=images'))
    const body = await res.json()

    expect(body.job.status).toBe('processing')
    expect(mocks.status).toHaveBeenCalledWith(expect.anything(), 'images')
  })

  it('lehnt ohne Session mit 401 ab, ohne die Fachfunktion aufzurufen', async () => {
    mocks.session.mockResolvedValue(null)
    const { GET } = await import('@/app/api/admin/glossary-jobs/route')

    const res = await GET(req(undefined, 'https://x/api/admin/glossary-jobs?kind=images'))

    expect(res.status).toBe(401)
    expect(mocks.status).not.toHaveBeenCalled()
  })

  it('weist eine unbekannte Art ab', async () => {
    const { GET } = await import('@/app/api/admin/glossary-jobs/route')

    const res = await GET(req(undefined, 'https://x/api/admin/glossary-jobs?kind=unsinn'))

    expect(res.status).toBe(400)
    expect(mocks.status).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/admin/glossary-jobs', () => {
  function patchReq(body: unknown) {
    return new Request('https://x/api/admin/glossary-jobs', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }) as any
  }

  it('lehnt ohne Session mit 401 ab, ohne die Fachfunktion aufzurufen', async () => {
    mocks.session.mockResolvedValue(null)
    const { PATCH } = await import('@/app/api/admin/glossary-jobs/route')

    const res = await PATCH(patchReq({ kind: 'generate' }))

    expect(res.status).toBe(401)
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('weist eine unbekannte Art ab', async () => {
    const { PATCH } = await import('@/app/api/admin/glossary-jobs/route')

    const res = await PATCH(patchReq({ kind: 'unsinn' }))

    expect(res.status).toBe(400)
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('merkt den Abbruchwunsch fuer die angefragte Art an', async () => {
    const { PATCH } = await import('@/app/api/admin/glossary-jobs/route')

    const res = await PATCH(patchReq({ kind: 'relink' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mocks.cancel).toHaveBeenCalledWith(expect.anything(), 'relink')
  })
})
