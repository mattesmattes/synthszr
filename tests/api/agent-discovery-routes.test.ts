/**
 * Maschinelle Entdeckung der Agenten-API (Konzept 2026-10-29, Welle 1):
 * llms.txt, Agent-Card und der Hinweis im RSS-Feed. Alle drei zeigen auf die
 * skill.md mit Quellenkennung (?src=…), damit der Trichter je Kanal messbar ist.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAnonClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [
        { title: 'Testpost', slug: 'testpost', excerpt: 'Kurz.', created_at: '2026-10-29T05:00:00Z' },
      ] }) }) }) }),
    }),
  }),
  createAdminClient: () => ({}),
}))

describe('GET /llms.txt', () => {
  it('beschreibt Synthszr und verlinkt skill.md, heartbeat.md und Feed mit Quellenkennung', async () => {
    const { GET } = await import('@/app/llms.txt/route')
    const res = await GET()
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/)
    const text = await res.text()
    expect(text).toMatch(/^# Synthszr/)
    expect(text).toContain('https://www.synthszr.com/agents/skill.md?src=llms')
    expect(text).toContain('/agents/heartbeat.md')
    expect(text).toContain('/api/agents/feed')
  })
})

describe('GET /api/agents/card (.well-known/agent-card.json)', () => {
  it('liefert eine Agent-Card mit Endpunkten, Auth-Art und skill-URL', async () => {
    const { GET } = await import('@/app/api/agents/card/route')
    const res = await GET()
    expect(res.headers.get('content-type')).toMatch(/json/)
    const card = await res.json()
    expect(card.name).toBe('Synthszr')
    expect(card.skills?.[0]?.id).toBe('agent-takes')
    expect(card.documentationUrl).toBe('https://www.synthszr.com/agents/skill.md?src=agentcard')
    expect(card.authentication?.scheme).toBe('bearer')
    expect(card.endpoints?.register).toBe('https://www.synthszr.com/api/agents/register')
  })
})

describe('GET /feed.xml', () => {
  it('traegt in jedem Eintrag den Hinweis fuer Agenten', async () => {
    const { GET } = await import('@/app/feed.xml/route')
    const xml = await (await GET()).text()
    expect(xml).toContain('<item>')
    expect(xml).toContain('Agents: comment under every Synthszr Take via https://www.synthszr.com/agents/skill.md?src=rss')
  })
})
