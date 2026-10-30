/**
 * POST /api/agents/register — offene Registrierung ohne Bestaetigung.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ checkRateLimit: vi.fn(), registerAgent: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getClientIP: () => '1.2.3.4',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
  rateLimiters: { agentRegister: () => undefined },
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/agents/accounts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agents/accounts')>('@/lib/agents/accounts')
  return { ...actual, registerAgent: mocks.registerAgent }
})
vi.mock('@/lib/agents/settings', () => ({
  loadAgentCommentSettings: async () => ({ enabled: true, daily_cap: 50, relevance_min: 0.55, paraphrase_max: 0.92, per_section_max: 5, feed_since: '2026-10-26' }),
}))

const VALID = { handle: 'argus', display_name: 'Argus', description: 'Liest täglich KI-News und widerspricht.', model: 'claude-opus-5' }
function post(body: unknown) {
  return new NextRequest('https://synthszr.com/api/agents/register', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkRateLimit.mockResolvedValue({ success: true })
  mocks.registerAgent.mockResolvedValue({ ok: true, apiKey: 'sk_agent_abcdefgh123', account: { id: 'a1', handle: 'argus', created_at: '2026-10-26T06:00:00Z' } })
})

describe('POST /api/agents/register', () => {
  it('lehnt ohne handle mit 400 ab', async () => {
    const { POST } = await import('@/app/api/agents/register/route')
    const { handle: _h, ...ohne } = VALID
    expect((await POST(post(ohne))).status).toBe(400)
    expect(mocks.registerAgent).not.toHaveBeenCalled()
  })

  it('registriert und liefert den Klartext-Schluessel genau hier', async () => {
    const { POST } = await import('@/app/api/agents/register/route')
    const res = await POST(post(VALID))
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.api_key).toBe('sk_agent_abcdefgh123')
    expect(body.limits).toMatchObject({ per_minute: 1, per_day: 5, daily_cap: 50 })
  })

  it('nimmt owner_handle/owner_contact aelterer skill.md-Kopien an, ohne 400', async () => {
    const { POST } = await import('@/app/api/agents/register/route')
    const res = await POST(post({ ...VALID, owner_handle: 'mattes', owner_contact: 'x' }))
    expect(res.status).toBe(201)
  })

  it('lehnt andere unbekannte Felder weiter mit 400 ab', async () => {
    const { POST } = await import('@/app/api/agents/register/route')
    expect((await POST(post({ ...VALID, owner: 'mattes' }))).status).toBe(400)
  })

  it('gibt 429 zurueck, wenn das IP-Limit greift', async () => {
    mocks.checkRateLimit.mockResolvedValue({ success: false })
    const { POST } = await import('@/app/api/agents/register/route')
    expect((await POST(post(VALID))).status).toBe(429)
  })

  it('gibt 409 bei vergebenem Handle', async () => {
    mocks.registerAgent.mockResolvedValue({ ok: false, error: 'handle_taken' })
    const { POST } = await import('@/app/api/agents/register/route')
    expect((await POST(post(VALID))).status).toBe(409)
  })
})
