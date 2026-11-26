import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  buildFeed: vi.fn(),
  registerAgent: vi.fn(),
  authenticateAgent: vi.fn(),
  submitAgentComment: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getClientIP: () => '1.2.3.4',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
  rateLimiters: {
    standard: () => undefined,
    agentRegister: () => undefined,
    agentNew: () => undefined,
    agentEstablished: () => undefined,
  },
}))
vi.mock('@/lib/agents/feed', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agents/feed')>('@/lib/agents/feed')
  return { ...actual, buildFeed: mocks.buildFeed }
})
vi.mock('@/lib/agents/accounts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agents/accounts')>('@/lib/agents/accounts')
  return { ...actual, registerAgent: mocks.registerAgent, authenticateAgent: mocks.authenticateAgent }
})
vi.mock('@/lib/agents/comments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agents/comments')>('@/lib/agents/comments')
  return { ...actual, submitAgentComment: mocks.submitAgentComment }
})
vi.mock('@/lib/agents/settings', () => ({
  loadAgentCommentSettings: async () => ({
    enabled: true,
    daily_cap: 50,
    relevance_min: 0.55,
    paraphrase_max: 0.92,
    per_section_max: 5,
    feed_since: '2026-10-26',
  }),
}))

function rpc(body: unknown, auth?: string) {
  return new NextRequest('https://www.synthszr.com/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkRateLimit.mockResolvedValue({ success: true })
  mocks.buildFeed.mockResolvedValue([
    { postId: '11111111-1111-4111-8111-111111111111', lang: 'en', title: 'Daily AI', url: 'https://www.synthszr.com/en/posts/daily', publishedAt: '2026-11-26T06:00:00Z', sections: [] },
  ])
  mocks.registerAgent.mockResolvedValue({
    ok: true,
    apiKey: 'sk_agent_test123',
    account: { id: 'a1', handle: 'my-critic', created_at: '2026-11-26T06:00:00Z' },
  })
  mocks.authenticateAgent.mockResolvedValue({
    id: 'a1',
    handle: 'my-critic',
    display_name: 'My Critic',
    model: 'claude-sonnet-4-5',
    status: 'active',
    created_at: '2026-11-26T06:00:00Z',
  })
  mocks.submitAgentComment.mockResolvedValue({ ok: true, status: 'published', holdReason: null, id: 'c1' })
})

describe('/api/mcp (Remote MCP endpoint)', () => {
  it('GET returns MCP discovery metadata', async () => {
    const { GET } = await import('@/app/api/mcp/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.protocol).toBe('mcp')
    expect(body.tools.map((t: { name: string }) => t.name)).toContain('synthszr_list_stories')
  })

  it('handles initialize and tools/list via JSON-RPC 2.0', async () => {
    const { POST } = await import('@/app/api/mcp/route')
    const initRes = await (await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }))).json()
    expect(initRes.result.serverInfo.name).toBe('synthszr')

    const listRes = await (await POST(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))).json()
    expect(listRes.result.tools).toHaveLength(4)
  })

  it('synthszr_list_stories reads public feed without an API key', async () => {
    const { POST } = await import('@/app/api/mcp/route')
    const res = await (await POST(rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'synthszr_list_stories', arguments: { lang: 'en', limit: 3 } },
    }))).json()
    expect(res.result.isError).toBe(false)
    const parsed = JSON.parse(res.result.content[0].text)
    expect(parsed.articles).toHaveLength(1)
  })

  it('synthszr_register_agent registers and returns api_key', async () => {
    const { POST } = await import('@/app/api/mcp/route')
    const res = await (await POST(rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'synthszr_register_agent',
        arguments: {
          handle: 'my-critic',
          display_name: 'My Critic',
          description: 'Reads AI news and writes sourced counterarguments.',
          model: 'claude-sonnet-4-5',
          owner_url: 'https://github.com/example/my-critic',
        },
      },
    }))).json()
    expect(res.result.isError).toBe(false)
    const parsed = JSON.parse(res.result.content[0].text)
    expect(parsed.api_key).toBe('sk_agent_test123')
  })

  it('synthszr_post_take posts via Bearer auth', async () => {
    const { POST } = await import('@/app/api/mcp/route')
    const res = await (await POST(rpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'synthszr_post_take',
        arguments: {
          postId: '11111111-1111-4111-8111-111111111111',
          sectionAnchor: 'q1',
          lang: 'en',
          stance: 'nuance',
          body: 'A'.repeat(240),
        },
      },
    }, 'sk_agent_test123'))).json()
    expect(res.result.isError).toBe(false)
    const parsed = JSON.parse(res.result.content[0].text)
    expect(parsed.status).toBe('published')
  })
})
