/**
 * GET /api/agents/feed und die statischen Onboarding-Dateien.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ authenticateAgent: vi.fn(), buildFeed: vi.fn(), checkRateLimit: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getClientIP: () => '1.2.3.4',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
  rateLimiters: { standard: () => undefined },
}))
vi.mock('@/lib/agents/accounts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agents/accounts')>('@/lib/agents/accounts')
  return { ...actual, authenticateAgent: mocks.authenticateAgent }
})
vi.mock('@/lib/agents/feed', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agents/feed')>('@/lib/agents/feed')
  return { ...actual, buildFeed: mocks.buildFeed }
})
vi.mock('@/lib/agents/settings', () => ({
  loadAgentCommentSettings: async () => ({ enabled: true, daily_cap: 50, relevance_min: 0.55, paraphrase_max: 0.92, per_section_max: 5, feed_since: '2026-10-26' }),
}))

const ACCOUNT = { id: 'a1', handle: 'argus', status: 'active', created_at: '2026-10-26T06:00:00Z' }
function get(url: string, key?: string) {
  return new NextRequest(url, { headers: key ? { authorization: `Bearer ${key}` } : {} })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkRateLimit.mockResolvedValue({ success: true })
  mocks.authenticateAgent.mockResolvedValue(ACCOUNT)
  mocks.buildFeed.mockResolvedValue([{ postId: 'p1', lang: 'de', title: 'T', url: 'u', publishedAt: 'x', sections: [] }])
})

describe('GET /api/agents/feed', () => {
  it('verlangt einen gueltigen Bearer-Schluessel', async () => {
    mocks.authenticateAgent.mockResolvedValue(null)
    const { GET } = await import('@/app/api/agents/feed/route')
    expect((await GET(get('https://x/api/agents/feed'))).status).toBe(401)
  })

  it('lehnt eine unbekannte Sprache ab', async () => {
    const { GET } = await import('@/app/api/agents/feed/route')
    expect((await GET(get('https://x/api/agents/feed?lang=xx', 'k'))).status).toBe(400)
  })

  it('liefert Artikel der Sprachfassung samt Limits und Skill-Version', async () => {
    const { GET } = await import('@/app/api/agents/feed/route')
    const res = await GET(get('https://x/api/agents/feed?lang=en&since=2026-10-20T00:00:00Z', 'k'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.articles).toHaveLength(1)
    expect(body.skill_version).toBe('1.0.0')
    expect(mocks.buildFeed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ lang: 'en', since: '2026-10-20T00:00:00.000Z', feedSince: '2026-10-26' }))
  })

  it('drosselt den Feed je Agent (Review: offene Registrierung, Volltext-Egress)', async () => {
    mocks.checkRateLimit.mockResolvedValue({ success: false })
    const { GET } = await import('@/app/api/agents/feed/route')
    expect((await GET(get('https://x/api/agents/feed', 'k'))).status).toBe(429)
    expect(mocks.checkRateLimit).toHaveBeenCalledWith('agents-feed:a1', undefined)
  })

  it('bleibt fuer gesperrte Agenten lesbar', async () => {
    mocks.authenticateAgent.mockResolvedValue({ ...ACCOUNT, status: 'suspended' })
    const { GET } = await import('@/app/api/agents/feed/route')
    expect((await GET(get('https://x/api/agents/feed', 'k'))).status).toBe(200)
  })
})

describe('skill.md und heartbeat.md', () => {
  it('liefert Markdown mit Version und den Endpunkten', async () => {
    const { GET } = await import('@/app/agents/skill.md/route')
    const res = await GET()
    expect(res.headers.get('content-type')).toMatch(/^text\/markdown/)
    expect(res.headers.get('x-skill-version')).toBe('1.0.0')
    const text = await res.text()
    expect(text).toContain('/api/agents/register')
    expect(text).toContain('/api/agents/comments')
    expect(text).toContain('/api/agents/feed')
  })

  it('heartbeat nennt den Rhythmus', async () => {
    const { GET } = await import('@/app/agents/heartbeat.md/route')
    const text = await (await GET()).text()
    expect(text).toMatch(/06:30/)
  })
})
