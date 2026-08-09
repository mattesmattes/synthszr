/**
 * Route des Wochenrueckblicks.
 *
 * Geprueft werden die Wege, die schiefgehen koennen und fuer die der Betreiber
 * eine klare Meldung braucht: keine Anmeldung, leere Woche, Verweigerung des
 * Modells. Der Erfolgsfall ist der einfachste.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  collectWeekTopics: vi.fn(),
  generateWrapup: vi.fn(),
  insertSingle: vi.fn(),
  getModelForUseCase: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/wrapup/collect', () => ({ collectWeekTopics: mocks.collectWeekTopics }))
vi.mock('@/lib/wrapup/generate', () => ({ generateWrapup: mocks.generateWrapup }))
vi.mock('@/lib/ai/model-config', () => ({ getModelForUseCase: mocks.getModelForUseCase }))
vi.mock('@/lib/utils/markdown-to-tiptap', () => ({
  markdownToTiptap: () => ({ type: 'doc', content: [] }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      insert: () => ({ select: () => ({ single: mocks.insertSingle }) }),
    }),
  }),
}))

function req() {
  return new NextRequest('https://x/api/admin/week-wrapup', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ isAdmin: true })
  mocks.getModelForUseCase.mockResolvedValue('claude-opus-5')
  mocks.collectWeekTopics.mockResolvedValue([
    { weekday: 'Montag', date: '2026-08-03', headline: 'H1', body: 'B1', postSlug: 'a' },
  ])
  mocks.generateWrapup.mockResolvedValue({
    title: 'AI-Week Wrap-up: 3.–8. August 2026',
    markdown: '## Montag — H1\n\nText.',
  })
  mocks.insertSingle.mockResolvedValue({ data: { id: 'post-1' }, error: null })
})

describe('POST /api/admin/week-wrapup', () => {
  it('lehnt ohne Anmeldung mit 401 ab, ohne das Modell zu rufen', async () => {
    mocks.getSession.mockResolvedValue(null)
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(mocks.generateWrapup).not.toHaveBeenCalled()
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
    expect(mocks.generateWrapup).not.toHaveBeenCalled()
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
    mocks.generateWrapup.mockRejectedValue(
      new Error('Modell hat die Antwort für Wochenrückblick verweigert (stop_reason: refusal)'),
    )
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const res = await POST(req())
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toMatch(/verweigert/i)
  })
})
