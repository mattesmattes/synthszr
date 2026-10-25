/**
 * Admin-Endpunkt fuer die Info-Box „neue Leser-Takes" (2026-10-25).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), listRecentComments: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/comments/recent', () => ({ listRecentComments: mocks.listRecentComments }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ isAdmin: true })
  mocks.listRecentComments.mockResolvedValue({ hours: 48, since: 'x', comments: [{ id: 'c1' }] })
})

describe('GET /api/admin/comments/recent', () => {
  it('lehnt ohne Anmeldung mit 401 ab', async () => {
    mocks.getSession.mockResolvedValue(null)
    const { GET } = await import('@/app/api/admin/comments/recent/route')
    const res = await GET(new NextRequest('https://x/api/admin/comments/recent'))
    expect(res.status).toBe(401)
    expect(mocks.listRecentComments).not.toHaveBeenCalled()
  })

  it('liefert die Kommentare der letzten 48 Stunden (Default)', async () => {
    const { GET } = await import('@/app/api/admin/comments/recent/route')
    const res = await GET(new NextRequest('https://x/api/admin/comments/recent'))
    expect(res.status).toBe(200)
    expect((await res.json()).comments).toHaveLength(1)
    expect(mocks.listRecentComments).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ hours: 48 }))
  })

  it('begrenzt ?hours auf 1 bis 168', async () => {
    const { GET } = await import('@/app/api/admin/comments/recent/route')
    await GET(new NextRequest('https://x/api/admin/comments/recent?hours=9999'))
    expect(mocks.listRecentComments).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ hours: 168 }))
    await GET(new NextRequest('https://x/api/admin/comments/recent?hours=abc'))
    expect(mocks.listRecentComments).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ hours: 48 }))
  })
})
