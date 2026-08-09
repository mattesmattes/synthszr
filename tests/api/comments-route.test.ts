/**
 * POST /api/comments — der zweite öffentlich beschreibbare Pfad des Projekts.
 *
 * Getestet wird die SICHERHEITS-Choreografie der Route, nicht die DB:
 * Origin → Rate-Limit → Zod → Honeypot → Identität → Moderation. Die
 * Service-Schicht ist gemockt (ihre Fachlogik hat eigene Tests in
 * comments-moderation/-reader-session); hier zählt, WEN die Route wann ruft
 * und was sie nach außen verrät.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireValidOrigin: vi.fn(),
  checkRateLimit: vi.fn(),
  postExists: vi.fn(),
  submitVerifiedComment: vi.fn(),
  submitUnverifiedComment: vi.fn(),
  resolveCommentToken: vi.fn(),
  openReaderSession: vi.fn(),
  sendMail: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<void> | void>,
}))

// `after` sammelt die Hintergrund-Arbeit; runAfter() spielt sie im Test ab, wie
// es die Runtime nach der Response täte. So bleibt der Mail-Pfad prüfbar.
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (cb: () => Promise<void> | void) => { mocks.afterCallbacks.push(cb) } }
})
async function runAfter() {
  for (const cb of mocks.afterCallbacks) await cb()
  mocks.afterCallbacks.length = 0
}

vi.mock('@/lib/security/origin-check', () => ({ requireValidOrigin: mocks.requireValidOrigin }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getClientIP: () => '1.2.3.4',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
  rateLimiters: { strict: () => undefined, relaxed: () => undefined },
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/comments/service', () => ({
  postExists: mocks.postExists,
  submitVerifiedComment: mocks.submitVerifiedComment,
  submitUnverifiedComment: mocks.submitUnverifiedComment,
  resolveCommentToken: mocks.resolveCommentToken,
  listPublishedComments: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/comments/reader-session', () => ({
  openReaderSession: mocks.openReaderSession,
  sealReaderSession: () => 'sealed',
  READER_COOKIE_NAME: 'synthszr_reader',
  READER_SESSION_TTL_SECONDS: 100,
}))
vi.mock('@/lib/resend/client', () => ({
  getResend: () => ({ emails: { send: mocks.sendMail } }),
  FROM_EMAIL: 'test@synthszr.com',
  BASE_URL: 'https://synthszr.com',
}))

const VALID = {
  postSource: 'generated_posts',
  postId: '11111111-2222-3333-4444-555555555555',
  body: 'Mein Gegen-Take.',
  displayName: 'Testleser',
}

function post(body: unknown, cookie?: string) {
  return new NextRequest('https://synthszr.com/api/comments', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie: `synthszr_reader=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.afterCallbacks.length = 0
  mocks.requireValidOrigin.mockReturnValue(null)
  mocks.checkRateLimit.mockResolvedValue({ success: true })
  mocks.postExists.mockResolvedValue(true)
  mocks.openReaderSession.mockReturnValue(null)
  mocks.resolveCommentToken.mockResolvedValue(null)
  mocks.submitVerifiedComment.mockResolvedValue({ status: 'published' })
  mocks.submitUnverifiedComment.mockResolvedValue({ verifyMail: null })
  mocks.sendMail.mockResolvedValue({})
})

describe('POST /api/comments — Schutzkette', () => {
  it('weist fremde Origins ab, bevor irgendetwas passiert', async () => {
    mocks.requireValidOrigin.mockReturnValue(new Response('forbidden', { status: 403 }))
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(post(VALID))
    expect(res.status).toBe(403)
    expect(mocks.submitVerifiedComment).not.toHaveBeenCalled()
    expect(mocks.submitUnverifiedComment).not.toHaveBeenCalled()
  })

  it('haelt das Rate-Limit ein', async () => {
    mocks.checkRateLimit.mockResolvedValue({ success: false })
    const { POST } = await import('@/app/api/comments/route')
    expect((await POST(post(VALID))).status).toBe(429)
  })

  it('weist unbekannte Felder ab (strict-Schema)', async () => {
    const { POST } = await import('@/app/api/comments/route')
    expect((await POST(post({ ...VALID, admin: true }))).status).toBe(400)
  })

  it('weist Kommentare an erfundene Post-IDs ab', async () => {
    mocks.postExists.mockResolvedValue(false)
    const { POST } = await import('@/app/api/comments/route')
    expect((await POST(post(VALID))).status).toBe(404)
  })

  it('schluckt Honeypot-Treffer mit ERFOLGS-Antwort, ohne zu speichern', async () => {
    // Ein Bot, der einen Fehler sieht, passt sein Skript an; einer, der
    // Erfolg sieht, zieht weiter.
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(post({ ...VALID, website: 'https://spam.example' }))
    expect(res.status).toBe(200)
    expect(mocks.submitVerifiedComment).not.toHaveBeenCalled()
    expect(mocks.submitUnverifiedComment).not.toHaveBeenCalled()
  })
})

describe('POST /api/comments — Identität', () => {
  it('nutzt den Reader-Cookie und liefert den Moderations-Status', async () => {
    mocks.openReaderSession.mockReturnValue({ subscriberId: 'sub-1' })
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(post(VALID, 'gueltig'))
    const data = await res.json()
    expect(data.status).toBe('published')
    expect(mocks.submitVerifiedComment).toHaveBeenCalledWith({}, 'sub-1', expect.objectContaining({ body: VALID.body }))
  })

  it('akzeptiert den Newsletter-Token als Identität und setzt den Cookie', async () => {
    mocks.resolveCommentToken.mockResolvedValue('sub-2')
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(post({ ...VALID, commentToken: 'raw-token' }))
    expect((await res.json()).status).toBe('published')
    expect(res.headers.get('set-cookie')).toContain('synthszr_reader=')
  })

  it('verlangt ohne Identität die E-Mail (email_required)', async () => {
    const { POST } = await import('@/app/api/comments/route')
    const res = await POST(post(VALID))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('email_required')
  })
})

describe('POST /api/comments — Anti-Enumeration', () => {
  it('antwortet fuer Abonnent und Unbekannt IDENTISCH und SOFORT (kein await auf die Mail)', async () => {
    const { POST } = await import('@/app/api/comments/route')

    // Abonnent: Mail-Arbeit ist zur Antwortzeit noch NICHT gelaufen (after).
    mocks.submitUnverifiedComment.mockResolvedValue({ verifyMail: { subscriberId: 's', rawToken: 't' } })
    const subscriber = await POST(post({ ...VALID, email: 'abo@example.com' }))
    const subscriberBody = await subscriber.json()
    // Response steht, bevor submitUnverifiedComment überhaupt lief — das ist der
    // ganze Punkt: kein Timing-Pfad, der den Abo-Status verrät.
    expect(mocks.submitUnverifiedComment).not.toHaveBeenCalled()

    mocks.submitUnverifiedComment.mockResolvedValue({ verifyMail: null })
    const stranger = await POST(post({ ...VALID, email: 'fremd@example.com' }))
    const strangerBody = await stranger.json()

    expect(subscriber.status).toBe(stranger.status)
    expect(subscriberBody).toEqual(strangerBody)
    expect(subscriberBody).toEqual({ status: 'verify_sent' })
  })

  it('mailt im Hintergrund nur an Abonnenten — nie an unbekannte Adressen', async () => {
    const { POST } = await import('@/app/api/comments/route')

    mocks.submitUnverifiedComment.mockResolvedValue({ verifyMail: null })
    await POST(post({ ...VALID, email: 'fremd@example.com' }))
    await runAfter()
    expect(mocks.sendMail).not.toHaveBeenCalled()

    mocks.submitUnverifiedComment.mockResolvedValue({ verifyMail: { subscriberId: 's', rawToken: 't' } })
    await POST(post({ ...VALID, email: 'abo@example.com' }))
    await runAfter()
    expect(mocks.sendMail).toHaveBeenCalledTimes(1)
  })
})
