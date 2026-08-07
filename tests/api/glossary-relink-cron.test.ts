/**
 * Taeglicher Anstoss der Nachverlinkung DEUTSCHER Artikel.
 *
 * Die Luecke, die dieser Cron schliesst (Betreiber-Frage 2026-08-07): beim
 * Erzeugen eines Begriffs lief bereits alles automatisch — veroeffentlichen,
 * Illustration, Produkt-Zuordnung, englische Fassung — und die Uebersetzungen
 * wurden vom 07:00-Cron nachverlinkt. Nur der `relink`-Job, der die neuen
 * Begriffe in den BESTEHENDEN deutschen Artikeln verlinkt, wurde von nichts
 * angelegt: createOrGetJob(…, 'relink') kam ausschliesslich aus der Admin-Route,
 * also aus einem Knopfdruck. Der Job-Typ existierte laengst, es fehlte nur der
 * Ausloeser.
 *
 * Zeitpunkt 06:00, eine Stunde VOR glossary-translations: relink fasst nur
 * `generated_posts` an, und die Uebersetzungs-Nachverlinkung nimmt ihre Slugs
 * aus dem deutschen Quelltext — in dieser Reihenfolge findet sie am selben Tag
 * etwas vor.
 *
 * Kein Kostenrisiko: Nachverlinken macht keine Modell-Aufrufe, es setzt Marks.
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
  return new NextRequest('https://x/api/cron/glossary-relink')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyCronAuth.mockReturnValue({ authorized: true, method: 'bearer' })
  mocks.createOrGetJob.mockResolvedValue({ id: 'j1', kind: 'relink', status: 'pending' })
})

describe('GET /api/cron/glossary-relink', () => {
  it('lehnt ohne gueltige Cron-Auth mit 401 ab, ohne einen Job anzulegen', async () => {
    // verifyCronAuth liefert ein Objekt, das immer truthy ist — geprueft werden
    // muss .authorized, sonst steht der Endpunkt offen.
    mocks.verifyCronAuth.mockReturnValue({ authorized: false, method: 'none' })
    const { GET } = await import('@/app/api/cron/glossary-relink/route')

    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(mocks.createOrGetJob).not.toHaveBeenCalled()
  })

  it('legt einen relink-Job an und antwortet 200', async () => {
    const { GET } = await import('@/app/api/cron/glossary-relink/route')

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mocks.createOrGetJob).toHaveBeenCalledWith({}, 'relink')
  })

  it('antwortet auch 200, wenn schon ein Lauf offen ist', async () => {
    // createOrGetJob ist idempotent (partieller Unique-Index): ein zweiter
    // Anstoss liefert den laufenden Job zurueck statt zu scheitern.
    mocks.createOrGetJob.mockResolvedValue({ id: 'j1', kind: 'relink', status: 'processing' })
    const { GET } = await import('@/app/api/cron/glossary-relink/route')

    const res = await GET(req())

    expect(res.status).toBe(200)
  })

  it('antwortet 200 auch wenn das Anlegen scheitert — Vercel fuehrt den Cron sonst als fehlgeschlagen', async () => {
    mocks.createOrGetJob.mockRejectedValue(new Error('DB weg'))
    const { GET } = await import('@/app/api/cron/glossary-relink/route')

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.error).toContain('DB weg')
  })
})
