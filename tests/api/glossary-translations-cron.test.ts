/**
 * Taeglicher Anstoss der Uebersetzungs-Nachverlinkung.
 *
 * Warum ein eigener Cron und nicht der bestehende glossary-review (05:00): die
 * Uebersetzungen des Tagesartikels entstehen erst gegen 06:30 (gemessen an
 * content_translations.translated_at). Ein Anstoss um 05:00 wuerde sie
 * systematisch verpassen und erst am Folgetag einholen — nicht-deutsche Leser
 * saehen die Lexikon-Links also immer einen Tag zu spaet.
 *
 * Warum nicht haeufiger: der Lauf setzt seinen Cursor am Ende zurueck, ein
 * erneuter Anstoss laeuft deshalb wieder durch den ganzen Bestand. Bei 743
 * Zeilen ist das taeglich vertretbar, alle 15 Minuten nicht.
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
  return new NextRequest('https://x/api/cron/glossary-translations')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyCronAuth.mockReturnValue({ authorized: true, method: 'bearer' })
  mocks.createOrGetJob.mockResolvedValue({ id: 'j1', kind: 'translations', status: 'pending' })
})

describe('GET /api/cron/glossary-translations', () => {
  it('lehnt ohne gueltige Cron-Auth mit 401 ab, ohne einen Job anzulegen', async () => {
    // Gleiche Begruendung wie bei glossary-jobs (Befund N5): verifyCronAuth
    // liefert ein Objekt, das immer truthy ist — geprueft werden muss
    // .authorized, sonst ist der Endpunkt offen.
    mocks.verifyCronAuth.mockReturnValue({ authorized: false, method: 'none' })
    const { GET } = await import('@/app/api/cron/glossary-translations/route')

    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(mocks.createOrGetJob).not.toHaveBeenCalled()
  })

  it('legt einen translations-Job an und antwortet 200', async () => {
    const { GET } = await import('@/app/api/cron/glossary-translations/route')

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mocks.createOrGetJob).toHaveBeenCalledWith({}, 'translations')
  })

  it('antwortet auch 200, wenn schon ein Lauf offen ist', async () => {
    // createOrGetJob ist idempotent (partieller Unique-Index): ein zweiter
    // Anstoss liefert den laufenden Job zurueck statt zu scheitern. Der Cron
    // darf daran nicht rot werden.
    mocks.createOrGetJob.mockResolvedValue({ id: 'j1', kind: 'translations', status: 'processing' })
    const { GET } = await import('@/app/api/cron/glossary-translations/route')

    const res = await GET(req())

    expect(res.status).toBe(200)
  })

  it('antwortet 200 auch wenn das Anlegen scheitert — Vercel fuehrt den Cron sonst als fehlgeschlagen', async () => {
    mocks.createOrGetJob.mockRejectedValue(new Error('DB weg'))
    const { GET } = await import('@/app/api/cron/glossary-translations/route')

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.error).toContain('DB weg')
  })
})
