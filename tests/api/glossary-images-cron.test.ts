/**
 * Taeglicher Anstoss der fehlenden Lexikon-Illustrationen.
 *
 * DIE LUECKE, DIE DAS SCHLIESST (Betreiber-Befund 2026-08-09): 284 Begriffe
 * standen ohne Illustration da, der letzte images-Job war vom 05.08. und
 * abgeschlossen. createOrGetJob(…, 'images') kam ausschliesslich aus der
 * Admin-Route — also aus einem Knopfdruck. Im Newsletter-Screen zeigte die
 * Statuszeile derweil einen Spinner, als liefe etwas.
 *
 * Dieselbe Bauart und derselbe Grund wie beim relink-Cron vom selben Tag: der
 * Job-Typ existierte laengst, es fehlte nur der Ausloeser.
 *
 * 08:00, also NACH translations (07:00): beide teilen sich den seriellen
 * Job-Slot, und die Nachverlinkung ist die kuerzere Arbeit.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyCronAuth: vi.fn(),
  createOrGetJob: vi.fn(),
}))

vi.mock('@/lib/security/cron-auth', () => ({ verifyCronAuth: mocks.verifyCronAuth }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/glossary/jobs/service', () => ({ createOrGetJob: mocks.createOrGetJob }))

function req() {
  return new NextRequest('https://x/api/cron/glossary-images')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyCronAuth.mockReturnValue({ authorized: true, method: 'bearer' })
  mocks.createOrGetJob.mockResolvedValue({ id: 'j1', kind: 'images', status: 'pending' })
})

describe('GET /api/cron/glossary-images', () => {
  it('lehnt ohne gueltige Cron-Auth mit 401 ab, ohne einen Job anzulegen', async () => {
    mocks.verifyCronAuth.mockReturnValue({ authorized: false, method: 'none' })
    const { GET } = await import('@/app/api/cron/glossary-images/route')
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mocks.createOrGetJob).not.toHaveBeenCalled()
  })

  it('legt einen images-Job an und antwortet 200', async () => {
    const { GET } = await import('@/app/api/cron/glossary-images/route')
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mocks.createOrGetJob).toHaveBeenCalledWith({}, 'images')
  })

  it('antwortet auch 200, wenn schon ein Lauf offen ist', async () => {
    // createOrGetJob ist idempotent (partieller Unique-Index): ein zweiter
    // Anstoss liefert den laufenden Job zurueck statt zu scheitern.
    mocks.createOrGetJob.mockResolvedValue({ id: 'j1', kind: 'images', status: 'processing' })
    const { GET } = await import('@/app/api/cron/glossary-images/route')
    expect((await GET(req())).status).toBe(200)
  })

  it('antwortet 200 auch wenn das Anlegen scheitert — Vercel fuehrt den Cron sonst als fehlgeschlagen', async () => {
    mocks.createOrGetJob.mockRejectedValue(new Error('DB weg'))
    const { GET } = await import('@/app/api/cron/glossary-images/route')
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.error).toContain('DB weg')
  })
})
