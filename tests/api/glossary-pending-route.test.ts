/**
 * /api/admin/glossary-pending — seit dem Job-Umbau (2026-08-05) ein duenner
 * Wrapper um runPendingUnit (lib/glossary/pending-run.ts), dieselbe Funktion,
 * die auch der 'pending'-Zweig von advanceJob aufruft. Der Endpunkt selbst
 * wird vom Panel nicht mehr benutzt (die for(;;)-Schleife ist raus), bleibt
 * aber fuer direkte Einzelaufrufe bestehen — Konsistenz mit
 * /api/admin/glossary-crawl.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  runPendingUnit: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/glossary/pending-run', () => ({ runPendingUnit: mocks.runPendingUnit }))

function req(body?: unknown) {
  return new Request('https://x/api/admin/glossary-pending', {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json' },
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: 'admin' })
})

describe('POST /api/admin/glossary-pending', () => {
  it('lehnt ohne Session mit 401 ab', async () => {
    mocks.session.mockResolvedValue(null)
    const { POST } = await import('@/app/api/admin/glossary-pending/route')

    const res = await POST(req({ postId: 'p1', confirmedSlugs: ['a'] }))

    expect(res.status).toBe(401)
    expect(mocks.runPendingUnit).not.toHaveBeenCalled()
  })

  it('weist eine fehlende postId mit 400 ab', async () => {
    const { POST } = await import('@/app/api/admin/glossary-pending/route')

    const res = await POST(req({ confirmedSlugs: ['a'] }))

    expect(res.status).toBe(400)
    expect(mocks.runPendingUnit).not.toHaveBeenCalled()
  })

  it('weist fehlende confirmedSlugs mit 400 ab', async () => {
    const { POST } = await import('@/app/api/admin/glossary-pending/route')

    const res = await POST(req({ postId: 'p1', confirmedSlugs: [] }))

    expect(res.status).toBe(400)
    expect(mocks.runPendingUnit).not.toHaveBeenCalled()
  })

  it('ruft runPendingUnit auf und gibt dessen Ergebnis zurueck', async () => {
    mocks.runPendingUnit.mockResolvedValue({ generated: ['Slop'], failed: [], remaining: 1, linked: 0 })
    const { POST } = await import('@/app/api/admin/glossary-pending/route')

    const res = await POST(req({ postId: 'p1', confirmedSlugs: ['a', 'b'] }))
    const body = await res.json()

    expect(mocks.runPendingUnit).toHaveBeenCalledWith(expect.anything(), 'p1', ['a', 'b'])
    expect(body).toEqual({ generated: ['Slop'], failed: [], remaining: 1, linked: 0 })
  })

  it('liefert 500 mit Fehlermeldung, wenn runPendingUnit wirft', async () => {
    mocks.runPendingUnit.mockRejectedValue(new Error('kaputt'))
    const { POST } = await import('@/app/api/admin/glossary-pending/route')

    const res = await POST(req({ postId: 'p1', confirmedSlugs: ['a'] }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('kaputt')
  })
})
