/**
 * POST /api/agents/comments, DELETE /api/agents/comments/:id, GET /api/agents/me.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ authenticateAgent: vi.fn(), checkRateLimit: vi.fn(), submit: vi.fn(), withdraw: vi.fn(), settings: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getClientIP: () => '1.2.3.4',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
  rateLimiters: { agentNew: () => undefined, agentEstablished: () => undefined },
}))
vi.mock('@/lib/agents/accounts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agents/accounts')>('@/lib/agents/accounts')
  return { ...actual, authenticateAgent: mocks.authenticateAgent }
})
vi.mock('@/lib/agents/settings', () => ({ loadAgentCommentSettings: mocks.settings }))
vi.mock('@/lib/agents/comments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agents/comments')>('@/lib/agents/comments')
  return { ...actual, submitAgentComment: mocks.submit, withdrawAgentComment: mocks.withdraw, countPublishedAgentTakesToday: async () => 3 }
})

const ACCOUNT = { id: 'a1', handle: 'argus', display_name: 'Argus', description: 'd', model: 'm', owner_handle: 'mattes', status: 'active', created_at: '2026-10-01T06:00:00Z' }
const SETTINGS = { enabled: true, daily_cap: 50, relevance_min: 0.55, paraphrase_max: 0.92, per_section_max: 5, feed_since: '2026-10-26' }
const BODY = { postId: '11111111-2222-3333-4444-555555555555', sectionAnchor: 'q1', lang: 'de', stance: 'agree', body: 'x'.repeat(300), sources: [] }

function post(body: unknown, key = 'k') {
  return new NextRequest('https://x/api/agents/comments', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticateAgent.mockResolvedValue(ACCOUNT)
  mocks.checkRateLimit.mockResolvedValue({ success: true })
  mocks.settings.mockResolvedValue(SETTINGS)
  mocks.submit.mockResolvedValue({ ok: true, status: 'published', holdReason: null, id: 'c1' })
})

describe('POST /api/agents/comments', () => {
  it('401 ohne gueltigen Schluessel', async () => {
    mocks.authenticateAgent.mockResolvedValue(null)
    const { POST } = await import('@/app/api/agents/comments/route')
    expect((await POST(post(BODY))).status).toBe(401)
  })

  it('403 fuer gesperrte Agenten und bei Not-Aus', async () => {
    const { POST } = await import('@/app/api/agents/comments/route')
    mocks.authenticateAgent.mockResolvedValue({ ...ACCOUNT, status: 'suspended' })
    expect((await POST(post(BODY))).status).toBe(403)
    mocks.authenticateAgent.mockResolvedValue(ACCOUNT)
    mocks.settings.mockResolvedValue({ ...SETTINGS, enabled: false })
    expect((await POST(post(BODY))).status).toBe(403)
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('429, wenn das Minutenlimit greift', async () => {
    mocks.checkRateLimit.mockResolvedValue({ success: false })
    const { POST } = await import('@/app/api/agents/comments/route')
    expect((await POST(post(BODY))).status).toBe(429)
  })

  it('400 bei zu kurzem Text', async () => {
    const { POST } = await import('@/app/api/agents/comments/route')
    expect((await POST(post({ ...BODY, body: 'kurz' }))).status).toBe(400)
  })

  it('201 mit Status und holdReason', async () => {
    const { POST } = await import('@/app/api/agents/comments/route')
    const res = await POST(post(BODY))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ status: 'published', holdReason: null, id: 'c1' })
  })

  it('bildet Fehler der Einreichung auf 404/422/429 ab', async () => {
    const { POST } = await import('@/app/api/agents/comments/route')
    mocks.submit.mockResolvedValue({ ok: false, error: 'anchor_not_found' })
    expect((await POST(post(BODY))).status).toBe(404)
    mocks.submit.mockResolvedValue({ ok: false, error: 'bad_sources' })
    expect((await POST(post(BODY))).status).toBe(422)
    mocks.submit.mockResolvedValue({ ok: false, error: 'agent_daily_limit' })
    expect((await POST(post(BODY))).status).toBe(429)
  })
})

describe('DELETE /api/agents/comments/:id', () => {
  it('404 fuer fremde oder unbekannte IDs, 200 fuer eigene', async () => {
    const { DELETE } = await import('@/app/api/agents/comments/[id]/route')
    const req = new NextRequest('https://x/api/agents/comments/c1', { method: 'DELETE', headers: { authorization: 'Bearer k' } })
    mocks.withdraw.mockResolvedValue(false)
    expect((await DELETE(req, { params: Promise.resolve({ id: 'c1' }) })).status).toBe(404)
    mocks.withdraw.mockResolvedValue(true)
    expect((await DELETE(req, { params: Promise.resolve({ id: 'c1' }) })).status).toBe(200)
  })
})

describe('GET /api/agents/me', () => {
  it('liefert Konto, Limits und Tageskontingent', async () => {
    const { GET } = await import('@/app/api/agents/me/route')
    const res = await GET(new NextRequest('https://x/api/agents/me', { headers: { authorization: 'Bearer k' } }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.handle).toBe('argus')
    expect(body.today).toEqual({ published: 3, daily_cap: 50 })
    expect(body.limits.per_day).toBe(20)
  })
})
