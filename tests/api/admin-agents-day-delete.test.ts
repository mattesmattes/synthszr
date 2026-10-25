/**
 * POST /api/admin/agents/day-delete — alle Agenten-Takes eines Berliner Tages
 * loeschen (Betreiber 2026-10-25), mit Vorschau. Leser-Takes bleiben unberuehrt.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), requireValidOrigin: vi.fn(), revalidate: vi.fn(), calls: [] as Array<[string, unknown[]]> }))
vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/security/origin-check', () => ({ requireValidOrigin: mocks.requireValidOrigin }))
vi.mock('@/lib/comments/service', () => ({ revalidatePostPaths: mocks.revalidate }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from() {
      const chain: Record<string, unknown> = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === 'then') return (res: (v: unknown) => void) => res({
            data: [{ id: 'c1', post_id: 'p1', agent_id: 'a1' }, { id: 'c2', post_id: 'p1', agent_id: 'a2' }, { id: 'c3', post_id: 'p2', agent_id: 'a1' }],
            error: null,
          })
          return (...args: unknown[]) => { mocks.calls.push([prop, args]); return chain }
        },
      })
      return chain
    },
  }),
}))

function post(body: unknown) {
  return new NextRequest('https://x/api/admin/agents/day-delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
const has = (m: string, ...args: unknown[]) => mocks.calls.some(([n, a]) => n === m && args.every((x, i) => a[i] === x))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.calls.length = 0
  mocks.getSession.mockResolvedValue({ email: 'admin@x' })
  mocks.requireValidOrigin.mockReturnValue(null)
})

describe('POST /api/admin/agents/day-delete', () => {
  it('401 ohne Session, 403 bei fremder Origin, 400 bei falschem Datum', async () => {
    const { POST } = await import('@/app/api/admin/agents/day-delete/route')
    mocks.getSession.mockResolvedValue(null)
    expect((await POST(post({ day: '2026-10-26' }))).status).toBe(401)
    mocks.getSession.mockResolvedValue({ email: 'admin@x' })
    mocks.requireValidOrigin.mockReturnValue(new Response('forbidden', { status: 403 }))
    expect((await POST(post({ day: '2026-10-26' }))).status).toBe(403)
    mocks.requireValidOrigin.mockReturnValue(null)
    expect((await POST(post({ day: '26.10.2026' }))).status).toBe(400)
  })

  it('Vorschau zaehlt Takes, Agenten und Artikel, loescht aber nicht', async () => {
    const { POST } = await import('@/app/api/admin/agents/day-delete/route')
    const body = await (await POST(post({ day: '2026-10-26', dryRun: true }))).json()
    expect(body).toEqual({ count: 3, agents: 2, posts: 2, dryRun: true })
    expect(has('delete')).toBe(false)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('loescht nur Agenten-Takes des Berliner Tages und revalidiert jeden Artikel einmal', async () => {
    const { POST } = await import('@/app/api/admin/agents/day-delete/route')
    const body = await (await POST(post({ day: '2026-10-26' }))).json()
    expect(body).toEqual({ count: 3, agents: 2, posts: 2, dryRun: false })
    expect(has('delete')).toBe(true)
    expect(has('eq', 'author_kind', 'agent')).toBe(true)
    // Winterzeit seit 25.10. 03:00: 26.10. 00:00 MEZ = 25.10. 23:00Z, 27.10. 00:00 MEZ = 26.10. 23:00Z
    expect(has('gte', 'created_at', '2026-10-25T23:00:00.000Z')).toBe(true)
    expect(has('lt', 'created_at', '2026-10-26T23:00:00.000Z')).toBe(true)
    expect(mocks.revalidate).toHaveBeenCalledTimes(2)
  })
})
