/**
 * /api/admin/agents — Einstellungen (Tageslimit, Schwellen, Not-Aus), Konten
 * sperren/entsperren, Schluessel widerrufen. Hausmuster: Session + Origin-Check.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), requireValidOrigin: vi.fn(), save: vi.fn(), update: vi.fn(), rows: [] as unknown[] }))
vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/security/origin-check', () => ({ requireValidOrigin: mocks.requireValidOrigin }))
vi.mock('@/lib/agents/settings', () => ({
  loadAgentCommentSettings: async () => ({ enabled: true, daily_cap: 50, relevance_min: 0.55, paraphrase_max: 0.92, per_section_max: 5, feed_since: '2026-10-26' }),
  saveAgentCommentSettings: mocks.save,
}))
vi.mock('@/lib/agents/comments', () => ({ countPublishedAgentTakesToday: async () => 4 }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from() {
      const chain: Record<string, unknown> = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === 'then') return (res: (v: unknown) => void) => res({ data: mocks.rows, error: null })
          return (...args: unknown[]) => { if (prop === 'update') mocks.update(args[0]); return chain }
        },
      })
      return chain
    },
  }),
}))

function patch(body: unknown) {
  return new NextRequest('https://x/api/admin/agents', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ email: 'admin@x' })
  mocks.requireValidOrigin.mockReturnValue(null)
  mocks.save.mockResolvedValue({ enabled: true, daily_cap: 80, relevance_min: 0.55, paraphrase_max: 0.92, per_section_max: 5, feed_since: '2026-10-26' })
  mocks.rows = [{ id: 'a1', handle: 'argus', status: 'active' }]
})

describe('GET /api/admin/agents', () => {
  it('401 ohne Session', async () => {
    mocks.getSession.mockResolvedValue(null)
    const { GET } = await import('@/app/api/admin/agents/route')
    expect((await GET()).status).toBe(401)
  })
  it('liefert Einstellungen, heutige Zahl und Konten', async () => {
    const { GET } = await import('@/app/api/admin/agents/route')
    const body = await (await GET()).json()
    expect(body.settings.daily_cap).toBe(50)
    expect(body.today).toEqual({ published: 4, daily_cap: 50 })
    expect(body.agents).toHaveLength(1)
  })

  it('liefert den Trichter der letzten 14 Tage: Abrufe je Kanal, Registrierungen, aktive Agenten, Takes', async () => {
    // Konzept 2026-10-29: ohne Trichter weiss niemand, welcher Kanal Agenten bringt.
    const { GET } = await import('@/app/api/admin/agents/route')
    const body = await (await GET()).json()
    expect(body.funnel).toMatchObject({ days: 14 })
    expect(body.funnel.fetchesBySrc).toBeTypeOf('object')
    expect(body.funnel).toHaveProperty('registrations')
    expect(body.funnel).toHaveProperty('activeAgents')
    expect(body.funnel).toHaveProperty('publishedTakes')
  })
})

describe('PATCH /api/admin/agents', () => {
  it('lehnt fremde Origin ab', async () => {
    mocks.requireValidOrigin.mockReturnValue(new Response('forbidden', { status: 403 }))
    const { PATCH } = await import('@/app/api/admin/agents/route')
    expect((await PATCH(patch({ settings: { daily_cap: 80 } }))).status).toBe(403)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('speichert Einstellungen', async () => {
    const { PATCH } = await import('@/app/api/admin/agents/route')
    const res = await PATCH(patch({ settings: { daily_cap: 80 } }))
    expect(res.status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), { daily_cap: 80 })
    expect((await res.json()).settings.daily_cap).toBe(80)
  })
  it('sperrt und entsperrt Agenten', async () => {
    const { PATCH } = await import('@/app/api/admin/agents/route')
    await PATCH(patch({ agentId: '11111111-1111-1111-1111-111111111111', action: 'suspend' }))
    expect(mocks.update).toHaveBeenLastCalledWith({ status: 'suspended' })
    await PATCH(patch({ agentId: '11111111-1111-1111-1111-111111111111', action: 'activate' }))
    expect(mocks.update).toHaveBeenLastCalledWith({ status: 'active' })
  })
  it('widerruft den Schluessel mit neuem Hash und zeigt den neuen Klartext einmal', async () => {
    const { PATCH } = await import('@/app/api/admin/agents/route')
    const res = await PATCH(patch({ agentId: '11111111-1111-1111-1111-111111111111', action: 'revoke' }))
    const payload = mocks.update.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(payload.api_key_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(payload.api_key_prefix).toHaveLength(8)
    expect((await res.json()).api_key).toMatch(/^sk_agent_/)
  })
  it('400 bei unbekannter Aktion', async () => {
    const { PATCH } = await import('@/app/api/admin/agents/route')
    expect((await PATCH(patch({ agentId: '11111111-1111-1111-1111-111111111111', action: 'explode' }))).status).toBe(400)
  })
})
