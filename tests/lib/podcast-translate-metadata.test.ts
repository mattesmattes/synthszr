/**
 * /api/podcast/translate-metadata — englische Podigee-Metadaten.
 *
 * PROD-BEFUND 2026-10-10: Titel und Show Notes erschienen auf der Podigee-
 * Export-Seite auf Deutsch. Ursache: Die Route füllte die Assistant-Antwort mit
 * „{" vor (Prefill). claude-haiku-5-5 (seit 2026-10-08 für
 * podcast_metadata_translation eingestellt) lehnt das mit 400 ab („This model
 * does not support assistant message prefill"). Der catch-Zweig gab still den
 * deutschen Titel zurück, die Seite füllte den deutschen Auszug nach.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/ai/usage-log', () => ({ withUsageLogging: (client: unknown) => client }))
vi.mock('@/lib/ai/model-config', () => ({ getModelForUseCase: async () => 'claude-haiku-5-5' }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.create }
  },
}))

function request(body: unknown) {
  return new Request('http://localhost/api/podcast/translate-metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

const textReply = (text: string) => ({ content: [{ type: 'text', text }] })

describe('POST /api/podcast/translate-metadata', () => {
  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue({ isAdmin: true })
    mocks.create.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('schickt keinen Assistant-Prefill — die letzte Nachricht ist vom User', async () => {
    mocks.create.mockResolvedValue(textReply('{"title":"T","subtitle":"S","description":"D"}'))
    const { POST } = await import('@/app/api/podcast/translate-metadata/route')
    await POST(request({ title: 'Deutscher Titel', excerpt: 'Deutscher Auszug' }))

    const messages = mocks.create.mock.calls[0][0].messages as Array<{ role: string }>
    expect(messages[messages.length - 1].role).toBe('user')
  })

  it('liest das JSON aus der Antwort (ohne vorangestelltes „{")', async () => {
    mocks.create.mockResolvedValue(textReply('{"title":"English Title","subtitle":"Teaser","description":"Two sentences. Here."}'))
    const { POST } = await import('@/app/api/podcast/translate-metadata/route')
    const res = await POST(request({ title: 'Deutscher Titel', excerpt: 'Deutscher Auszug' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ title: 'English Title', subtitle: 'Teaser', description: 'Two sentences. Here.' })
  })

  it('liest das JSON auch aus Code-Fence mit Vorrede', async () => {
    mocks.create.mockResolvedValue(textReply('Here you go:\n```json\n{"title":"T2","subtitle":"S2","description":"D2"}\n```'))
    const { POST } = await import('@/app/api/podcast/translate-metadata/route')
    const res = await POST(request({ title: 'Deutscher Titel', excerpt: '' }))

    expect(await res.json()).toEqual({ title: 'T2', subtitle: 'S2', description: 'D2' })
  })

  it('meldet einen Modellfehler als 502 statt still den deutschen Titel zu liefern', async () => {
    mocks.create.mockRejectedValue(Object.assign(new Error('This model does not support assistant message prefill.'), { status: 400 }))
    const { POST } = await import('@/app/api/podcast/translate-metadata/route')
    const res = await POST(request({ title: 'Deutscher Titel', excerpt: 'Deutscher Auszug' }))

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBeTruthy()
    expect(body.title).toBeUndefined()
  })
})
