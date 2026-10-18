/**
 * Zeitplan-API (2026-10-18): `timezone` ist ein IANA-Name; ein ungültiger wird
 * mit 400 abgewiesen, ein fehlender bleibt erlaubt (alte Konfigurationen,
 * der Scheduler nimmt dann Europe/Berlin).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ session: vi.fn(), upsert: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ upsert: mocks.upsert }) }),
}))

import { PUT } from '@/app/api/admin/schedule/route'

const base = {
  newsletterFetch: { enabled: true, hour: 4, minute: 30 },
  webcrawlFetch: { enabled: true, hour: 4, minute: 35 },
  dailyAnalysis: { enabled: true, hour: 4, minute: 45 },
  postGeneration: { enabled: true, hour: 5, minute: 0, maxItems: 40 },
}
const put = (body: unknown) => PUT(new Request('https://x/api/admin/schedule', {
  method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
}) as any)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: 'admin' })
  mocks.upsert.mockResolvedValue({ error: null })
})

describe('PUT /api/admin/schedule — timezone', () => {
  it('speichert eine gueltige IANA-Zone mit', async () => {
    const res = await put({ ...base, timezone: 'Asia/Shanghai' })
    expect(res.status).toBe(200)
    expect(mocks.upsert).toHaveBeenCalledWith(
      { key: 'schedule_config', value: { ...base, timezone: 'Asia/Shanghai' } },
      { onConflict: 'key' },
    )
  })

  it('weist eine ungueltige Zone mit 400 ab und schreibt nichts', async () => {
    const res = await put({ ...base, timezone: 'Mars/Olympus' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Ungültige Zeitzone: Mars/Olympus' })
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('ohne timezone bleibt alles wie bisher', async () => {
    const res = await put(base)
    expect(res.status).toBe(200)
    expect(mocks.upsert).toHaveBeenCalledWith({ key: 'schedule_config', value: base }, { onConflict: 'key' })
  })
})
