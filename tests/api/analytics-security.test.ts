import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// --- Mocks --------------------------------------------------------------
// vi.mock factories are hoisted above imports; only vi.hoisted()-created
// bindings (or identifiers starting with "mock") may be referenced inside
// them, so all shared mock state lives in `mocks`.

const mocks = vi.hoisted(() => ({
  insert: vi.fn(async () => ({ error: null })),
  dedupSelect: vi.fn(async () => ({ data: [] as { id: string }[], error: null })),
  rateLimit: { success: true },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: mocks.insert,
      select: () => ({
        eq: () => ({
          eq: () => ({
            gte: () => ({
              limit: mocks.dedupSelect,
            }),
          }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({
      success: mocks.rateLimit.success,
      remaining: mocks.rateLimit.success ? 99 : 0,
      reset: Date.now() + 60_000,
      limit: 100,
    })),
  }
})

import { POST as postEventHandler } from '@/app/api/track/event/route'
import { POST as postPlayHandler } from '@/app/api/track/podcast-play/route'

// --- Helpers --------------------------------------------------------------

function makeRequest(url: string, body: string | object): NextRequest {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  })
}

async function postEvent(body: string | object) {
  return postEventHandler(makeRequest('http://localhost/api/track/event', body))
}

async function postPlay(body: string | object) {
  return postPlayHandler(makeRequest('http://localhost/api/track/podcast-play', body))
}

const VALID_POST_ID = '123e4567-e89b-12d3-a456-426614174000'

describe('Analytics write security (SEC-008)', () => {
  beforeEach(() => {
    mocks.rateLimit.success = true
    mocks.insert.mockClear()
    mocks.dedupSelect.mockClear()
  })

  describe('/api/track/event', () => {
    it('rejects a body over 8 KiB with 413 and never reaches the DB', async () => {
      const res = await postEvent('x'.repeat(9 * 1024))
      expect(res.status).toBe(413)
      expect(mocks.insert).not.toHaveBeenCalled()
    })

    it('rejects an unknown eventType with 400 and never reaches the DB', async () => {
      const res = await postEvent({ eventType: 'not-allowed' })
      expect(res.status).toBe(400)
      expect(mocks.insert).not.toHaveBeenCalled()
    })

    it('rejects unknown fields (strict schema) with 400', async () => {
      const res = await postEvent({ eventType: 'page_view', evil: 'dropall' })
      expect(res.status).toBe(400)
      expect(mocks.insert).not.toHaveBeenCalled()
    })

    it('accepts a valid page_view event actually sent by the client tracker', async () => {
      const res = await postEvent({ eventType: 'page_view', path: '/de/some-post' })
      expect(res.status).toBe(200)
      expect(mocks.insert).toHaveBeenCalledTimes(1)
    })

    it('accepts a valid synthszr_vote_click event with company field', async () => {
      const res = await postEvent({ eventType: 'synthszr_vote_click', path: '/de/x', company: 'Nvidia' })
      expect(res.status).toBe(200)
      expect(mocks.insert).toHaveBeenCalledTimes(1)
    })

    it('returns 429 when the rate limit is exceeded, before parsing the body or touching the DB', async () => {
      mocks.rateLimit.success = false
      const res = await postEvent({ eventType: 'page_view' })
      expect(res.status).toBe(429)
      expect(mocks.insert).not.toHaveBeenCalled()
    })
  })

  describe('/api/track/podcast-play', () => {
    it('rejects a non-UUID postId with 400', async () => {
      const res = await postPlay({ postId: 'not-a-uuid', locale: 'xx' })
      expect(res.status).toBe(400)
      expect(mocks.insert).not.toHaveBeenCalled()
    })

    it('rejects an unsupported locale with 400', async () => {
      const res = await postPlay({ postId: VALID_POST_ID, locale: 'xx' })
      expect(res.status).toBe(400)
      expect(mocks.insert).not.toHaveBeenCalled()
    })

    it('accepts a valid payload matching what audio-player.tsx sends', async () => {
      const res = await postPlay({ postId: VALID_POST_ID, locale: 'en' })
      expect(res.status).toBe(200)
      expect(mocks.insert).toHaveBeenCalledTimes(1)
    })

    it('rejects a body over 8 KiB with 413', async () => {
      const res = await postPlay('x'.repeat(9 * 1024))
      expect(res.status).toBe(413)
      expect(mocks.insert).not.toHaveBeenCalled()
    })

    it('returns 429 when the rate limit is exceeded, before touching the DB', async () => {
      mocks.rateLimit.success = false
      const res = await postPlay({ postId: VALID_POST_ID })
      expect(res.status).toBe(429)
      expect(mocks.insert).not.toHaveBeenCalled()
    })
  })
})
