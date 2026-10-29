/** Cron der Hausagenten: Cron-Secret oder Admin-Session, sonst 401; ohne Agenten ein leerer Lauf. */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireCronOrAdmin: vi.fn(), loadHouseAgents: vi.fn(), runHouseAgent: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ requireCronOrAdmin: mocks.requireCronOrAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/agents/house', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agents/house')>('@/lib/agents/house')
  return { ...actual, loadHouseAgents: mocks.loadHouseAgents, runHouseAgent: mocks.runHouseAgent }
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireCronOrAdmin.mockResolvedValue(null)
  mocks.loadHouseAgents.mockResolvedValue([{ handle: 'argus', api_key: 'k', persona: 'p', langs: ['de'], max_takes_per_day: 2 }])
  mocks.runHouseAgent.mockResolvedValue({ handle: 'argus', planned: 1, submitted: 1, published: 1, pending: 0, rejected: 0 })
})

describe('GET /api/cron/agent-heartbeat', () => {
  it('401 ohne Berechtigung', async () => {
    mocks.requireCronOrAdmin.mockResolvedValue(new Response('nope', { status: 401 }))
    const { GET } = await import('@/app/api/cron/agent-heartbeat/route')
    expect((await GET(new NextRequest('https://x/api/cron/agent-heartbeat'))).status).toBe(401)
    expect(mocks.runHouseAgent).not.toHaveBeenCalled()
  })

  it('laesst jeden Hausagenten einmal laufen und meldet die Zusammenfassung', async () => {
    const { GET } = await import('@/app/api/cron/agent-heartbeat/route')
    const res = await GET(new NextRequest('https://x/api/cron/agent-heartbeat'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0].published).toBe(1)
  })

  it('ist ohne konfigurierte Agenten ein leerer Lauf', async () => {
    mocks.loadHouseAgents.mockResolvedValue([])
    const { GET } = await import('@/app/api/cron/agent-heartbeat/route')
    const body = await (await GET(new NextRequest('https://x/api/cron/agent-heartbeat'))).json()
    expect(body.runs).toEqual([])
  })
})
