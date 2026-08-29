/**
 * Der Techmeme-Lauf laesst sich jetzt aus dem Admin anstossen (Knopf neben
 * WebCrawl in /admin/daily-repo). Vorher ging das nur ueber das
 * Vercel-Dashboard.
 *
 * Zwei Eigenschaften sind hier wichtig:
 *  - Ohne Sitzung kein Lauf. Die Route stoesst 130 fremde Abrufe an und
 *    schreibt in die News-Queue; sie darf nicht offen stehen.
 *  - Anders als der Cron meldet sie einen Fehlschlag ehrlich. Der Cron
 *    antwortet bewusst immer mit 200, damit Vercel nicht wegen eines fremden
 *    Servers Alarm schlaegt — hier steht ein Mensch davor, der das Ergebnis
 *    sehen will.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  runTechmemeJob: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/techmeme/job', () => ({ runTechmemeJob: mocks.runTechmemeJob }))

beforeEach(() => {
  mocks.getSession.mockReset()
  mocks.runTechmemeJob.mockReset()
})

describe('POST /api/admin/techmeme-run', () => {
  it('weist ohne Sitzung ab, ohne den Job anzustossen', async () => {
    mocks.getSession.mockResolvedValue(null)
    const { POST } = await import('@/app/api/admin/techmeme-run/route')
    const res = await POST()
    expect(res.status).toBe(401)
    expect(mocks.runTechmemeJob).not.toHaveBeenCalled()
  })

  it('reicht das Ergebnis des Laufs durch', async () => {
    mocks.getSession.mockResolvedValue({ email: 'admin@x' })
    mocks.runTechmemeJob.mockResolvedValue({ stories: 20, relevant: 8, hinzugefuegt: 32, themen: 5, offen: 0, fehler: [] })
    const { POST } = await import('@/app/api/admin/techmeme-run/route')
    const res = await POST()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, hinzugefuegt: 32, themen: 5 })
  })

  it('meldet einen Fehlschlag als Fehler, nicht als Erfolg', async () => {
    mocks.getSession.mockResolvedValue({ email: 'admin@x' })
    mocks.runTechmemeJob.mockRejectedValue(new Error('Techmeme nicht erreichbar'))
    const { POST } = await import('@/app/api/admin/techmeme-run/route')
    const res = await POST()
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'Techmeme nicht erreichbar' })
  })
})
