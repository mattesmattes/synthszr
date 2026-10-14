/**
 * Admin-API der Morgenkonferenz (Task 13, Anhang A Step 1): Liste der Läufe
 * und Detail eines einzelnen Laufs fürs read-only Panel `/admin/curation`.
 * Muster: tests/api/glossary-jobs-route.test.ts (vi.hoisted-Mocks,
 * Request-Factory, beforeEach mit vi.clearAllMocks).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => null as Response | null),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  getRunUnits: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ requireAdmin: m.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/curation/service', () => ({
  listRuns: m.listRuns,
  getRun: m.getRun,
  getRunUnits: m.getRunUnits,
}))

const req = (q = '') => new Request(`https://x/api/admin/curation/runs${q}`) as any

beforeEach(() => vi.clearAllMocks())

describe('GET /api/admin/curation/runs', () => {
  it('401 ohne Session', async () => {
    m.requireAdmin.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Nicht autorisiert' }), { status: 401 }))
    const { GET } = await import('@/app/api/admin/curation/runs/route')
    expect((await GET(req())).status).toBe(401)
  })

  it('Liste mit limit (max 100)', async () => {
    m.listRuns.mockResolvedValue([{ id: 'a' }])
    const { GET } = await import('@/app/api/admin/curation/runs/route')
    expect(await (await GET(req('?limit=500'))).json()).toEqual({ runs: [{ id: 'a' }] })
    expect(m.listRuns).toHaveBeenCalledWith({}, { limit: 100 })
  })

  it('Detail liefert Run ohne Cards, Einheiten und Titel-Map', async () => {
    m.getRun.mockResolvedValue({
      id: 'r',
      cards: [{ id: 'x', core: 'c' }],
      pool: { items: [{ id: 'x', title: 'Titel X' }] },
      brief: { systemPrefix: 'p', dayBlock: 'd', precedentIds: {}, meta: {} },
    })
    m.getRunUnits.mockResolvedValue([{ unit_key: 'u', member_ids: ['x'] }])
    const { GET } = await import('@/app/api/admin/curation/runs/route')
    const body = await (await GET(req('?id=r'))).json()
    expect(body.run.cards).toBeUndefined()
    expect(body.run.pool).toBeUndefined()
    expect(body.units).toHaveLength(1)
    expect(body.titles).toEqual({ x: 'Titel X' })

    m.getRun.mockResolvedValueOnce(null)
    expect((await GET(req('?id=nix'))).status).toBe(404)
  })

  it('Service-Fehler liefert 500, mit Migrationshinweis bei schema cache', async () => {
    m.listRuns.mockRejectedValueOnce(new Error('curation_runs: schema cache miss'))
    const { GET } = await import('@/app/api/admin/curation/runs/route')
    const res = await GET(req())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('Migration 20261014090000 einspielen')
  })
})
