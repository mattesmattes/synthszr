/**
 * skill.md-Abrufe je Kanal protokollieren (Konzept 2026-10-29, „Messen, was
 * wirkt"): ?src=<kanal> landet in agent_skill_fetches; unbekannte Kennungen
 * werden zu 'direct'. Das Protokoll ist Beiwerk — ein DB-Fehler darf die
 * Auslieferung der Datei nicht stoeren.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ insert: vi.fn(), pending: [] as Promise<unknown>[] }))
// `after` laeuft nach der Antwort; im Test sammeln wir die Arbeit und warten vor der Assertion.
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (cb: () => unknown) => { mocks.pending.push(Promise.resolve().then(cb)) } }
})
async function flush() { await Promise.all(mocks.pending); mocks.pending.length = 0 }
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ insert: (p: unknown) => { mocks.insert(p); return Promise.resolve({ error: null }) } }) }),
}))

beforeEach(() => { vi.clearAllMocks(); mocks.pending.length = 0 })

describe('GET /agents/skill.md mit Quellenkennung', () => {
  it('protokolliert eine bekannte Kennung samt User-Agent-Klasse', async () => {
    const { GET } = await import('@/app/agents/skill.md/route')
    const res = await GET(new NextRequest('https://www.synthszr.com/agents/skill.md?src=clawhub', { headers: { 'user-agent': 'curl/8.4.0' } }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/markdown/)
    await flush()
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ src: 'clawhub', ua_class: 'cli' }))
  })

  it('ordnet unbekannte Kennungen als direct ein und klassifiziert Browser', async () => {
    const { GET } = await import('@/app/agents/skill.md/route')
    await GET(new NextRequest('https://www.synthszr.com/agents/skill.md?src=<script>', { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/130' } }))
    await flush()
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ src: 'direct', ua_class: 'browser' }))
  })

  it('liefert die Datei auch, wenn das Protokoll scheitert', async () => {
    mocks.insert.mockImplementation(() => { throw new Error('db down') })
    const { GET } = await import('@/app/agents/skill.md/route')
    const res = await GET(new NextRequest('https://www.synthszr.com/agents/skill.md'))
    await flush()
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('/api/agents/register')
  })
})
