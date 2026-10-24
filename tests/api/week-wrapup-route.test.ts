/**
 * Route des Wochenrueckblicks.
 *
 * Geprueft werden die Wege, die schiefgehen koennen und fuer die der Betreiber
 * eine klare Meldung braucht: keine Anmeldung, leere Woche, Verweigerung des
 * Modells. Der Erfolgsfall ist der einfachste.
 *
 * DER ZUSAMMENBAU IST BEWUSST NICHT GEMOCKT. Ein Mock an dieser Stelle hat am
 * 2026-08-09 schon einmal einen Prod-Fehler verdeckt (damals die
 * Markdown-Konvertierung, die serverseitig mit "there is no window object"
 * warf): der Test lief gruen, der Knopf im Admin nicht. Was nur auf dem Server
 * laeuft, darf hier nicht wegabstrahiert werden.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  collectWeekTopics: vi.fn(),
  generateWrapupParts: vi.fn(),
  researchWeekUpdates: vi.fn(),
  insertSingle: vi.fn(),
  getModelForUseCase: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/wrapup/collect', () => ({ collectWeekTopics: mocks.collectWeekTopics }))
vi.mock('@/lib/wrapup/generate', () => ({ generateWrapupParts: mocks.generateWrapupParts }))
// Die Recherche ruft Anthropic mit Web-Suche — im Test gemockt, sonst liefe sie
// mit dem Key aus .env.local gegen das echte Netz.
vi.mock('@/lib/wrapup/research', () => ({ researchWeekUpdates: mocks.researchWeekUpdates }))
vi.mock('@/lib/ai/model-config', () => ({ getModelForUseCase: mocks.getModelForUseCase }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      insert: () => ({ select: () => ({ single: mocks.insertSingle }) }),
    }),
  }),
}))

function req(body?: unknown) {
  return new NextRequest('https://x/api/admin/week-wrapup', {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ isAdmin: true })
  mocks.getModelForUseCase.mockResolvedValue('claude-opus-5')
  mocks.collectWeekTopics.mockResolvedValue([
    {
      weekday: 'Montag', date: '2026-08-03', headline: 'H1', body: 'B1',
      takeText: 'Synthszr Take: Alt.', headingNode: null,
      bodyNodes: [{ type: 'paragraph', content: [{ type: 'text', text: 'B1' }] }],
      postSlug: 'a',
    },
  ])
  mocks.generateWrapupParts.mockResolvedValue({
    title: 'AI-Week Wrap-up: 3.–8. August 2026',
    parts: {
      intro: 'Vorlauf.',
      excerptBullets: ['Erste Zeile', 'Zweite Zeile', 'Dritte Zeile'],
      sections: [{ weekday: 'Montag', take: 'Kurz.' }],
    },
  })
  mocks.insertSingle.mockResolvedValue({ data: { id: 'post-1' }, error: null })
  mocks.researchWeekUpdates.mockResolvedValue([])
})

describe('POST /api/admin/week-wrapup', () => {
  it('lehnt ohne Anmeldung mit 401 ab, ohne das Modell zu rufen', async () => {
    mocks.getSession.mockResolvedValue(null)
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(mocks.generateWrapupParts).not.toHaveBeenCalled()
  })

  it('meldet eine leere Woche klar, statt einen leeren Entwurf anzulegen', async () => {
    // Ein leerer Entwurf waere in der Artikelliste nicht von einem misslungenen
    // zu unterscheiden.
    mocks.collectWeekTopics.mockResolvedValue([])
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const res = await POST(req())
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/keine/i)
    expect(mocks.generateWrapupParts).not.toHaveBeenCalled()
  })

  it('legt den Entwurf an und meldet die Zahl der Themen', async () => {
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const res = await POST(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.postId).toBe('post-1')
    expect(body.topicCount).toBe(1)
    expect(body.weekLabel).toBeTruthy()
  })

  it('reicht eine Verweigerung als Fehlermeldung durch', async () => {
    // Ein Wrap-up haengt an EINEM Aufruf — eine Verweigerung kostet den ganzen
    // Post. Der Betreiber muss den Grund sehen, nicht nur ein Scheitern.
    mocks.generateWrapupParts.mockRejectedValue(
      new Error('Modell hat die Antwort für Wochenrückblick verweigert (stop_reason: refusal)'),
    )
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const res = await POST(req())
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toMatch(/verweigert/i)
  })

  it('reicht die Recherche-Ergebnisse an den Compose-Aufruf und in die Antwort durch', async () => {
    const upd = {
      weekday: 'Montag', updateLevel: 'major', summary: 'S',
      sources: [{ url: 'https://r.de', title: 'R', date: '2026-08-05' }], searches: 2,
    }
    mocks.researchWeekUpdates.mockResolvedValue([upd])
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const body = await (await POST(req())).json()
    expect(mocks.generateWrapupParts).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'claude-opus-5', [upd])
    expect(body.updates).toEqual([{ weekday: 'Montag', updateLevel: 'major', searches: 2 }])
  })

  it('baut den Entwurf auch dann, wenn die Recherche scheitert', async () => {
    // Spec: ein gescheitertes Thema ergibt none; ein Totalausfall der
    // Recherche darf den Rueckblick nicht verhindern.
    mocks.researchWeekUpdates.mockRejectedValue(new Error('timeout'))
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect((await res.json()).updates).toEqual([])
  })

  // --- Frei waehlbarer Zeitraum (Betreiber-Wunsch 2026-10-24) ---------------
  it('nutzt den gewaehlten Zeitraum als Fenster fuer die Themen', async () => {
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const res = await POST(req({ from: '2026-10-20', to: '2026-10-24' }))
    expect(res.status).toBe(200)
    // 00:00 Berlin (MESZ) = 22:00Z des Vortags; der letzte Tag zaehlt ganz.
    expect(mocks.collectWeekTopics).toHaveBeenCalledWith(expect.anything(), '2026-10-19T22:00:00.000Z', '2026-10-24T22:00:00.000Z')
    expect((await res.json()).weekLabel).toBe('20. bis 24. Oktober 2026')
  })

  it('lehnt einen verdrehten Zeitraum mit 400 ab, ohne das Modell zu rufen', async () => {
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const res = await POST(req({ from: '2026-10-24', to: '2026-10-20' }))
    expect(res.status).toBe(400)
    expect(mocks.generateWrapupParts).not.toHaveBeenCalled()
  })

  it('lehnt ein Enddatum in der Zukunft ab', async () => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() + 2)
    const zukunft = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(d)
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const res = await POST(req({ from: zukunft, to: zukunft }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Zukunft/)
  })
})
