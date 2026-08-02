import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// --- Mocks --------------------------------------------------------------
// vi.mock factories are hoisted above imports; only vi.hoisted()-created
// bindings (or identifiers starting with "mock") may be referenced inside
// them, so all shared mock state lives in `mocks`.
//
// generatePodcastForPost() is a private (non-exported) function in the
// route module — it does the actual LLM/TTS/blob work. Instead of mocking
// it directly, we assert the "no side effect" requirement one level down:
// a DB write (upsert/delete on post_podcasts) or blob call would be the
// only way generation could start, so `mocks.podcastWrite` staying
// uncalled proves generation never ran.

const VALID_POST_ID = '123e4567-e89b-12d3-a456-426614174000'

const mocks = vi.hoisted(() => ({
  session: null as { isAdmin: boolean } | null,
  publishedPost: { id: '123e4567-e89b-12d3-a456-426614174000' } as { id: string } | null,
  podcastRow: null as
    | { audio_url: string | null; status: string; duration_seconds: number | null; created_at: string }
    | null,
  podcastWrite: vi.fn(async () => ({ error: null })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'generated_posts') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: mocks.publishedPost, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'post_podcasts') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: mocks.podcastRow, error: null }),
              }),
            }),
          }),
          upsert: mocks.podcastWrite,
          delete: () => ({
            eq: () => ({
              eq: mocks.podcastWrite,
            }),
          }),
        }
      }
      throw new Error(`Unexpected table in test mock: ${table}`)
    },
  }),
}))

vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mocks.session,
}))

import { GET as getPodcastHandler, POST as postPodcastHandler } from '@/app/api/podcast/[postId]/route'

// --- Helpers --------------------------------------------------------------

function paramsFor(postId: string) {
  return { params: Promise.resolve({ postId }) }
}

async function getPodcast(postId: string, query = '') {
  const req = new NextRequest(`http://localhost/api/podcast/${postId}${query}`)
  return getPodcastHandler(req, paramsFor(postId))
}

async function postPodcast(postId: string, body: unknown = {}) {
  const req = new NextRequest(`http://localhost/api/podcast/${postId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return postPodcastHandler(req, paramsFor(postId))
}

describe('Podcast endpoint security (SEC-013)', () => {
  beforeEach(() => {
    mocks.session = null
    mocks.publishedPost = { id: VALID_POST_ID }
    mocks.podcastRow = null
    mocks.podcastWrite.mockClear()
  })

  describe('GET /api/podcast/[postId] (public reader — read-only)', () => {
    it('rejects generate=true with 400 and never touches post_podcasts', async () => {
      const res = await getPodcast(VALID_POST_ID, '?locale=en&generate=true')
      expect(res.status).toBe(400)
      expect(mocks.podcastWrite).not.toHaveBeenCalled()
    })

    it('rejects force=true with 400 and never touches post_podcasts', async () => {
      const res = await getPodcast(VALID_POST_ID, '?locale=en&force=true')
      expect(res.status).toBe(400)
      expect(mocks.podcastWrite).not.toHaveBeenCalled()
    })

    it('rejects an unsupported locale with 400', async () => {
      const res = await getPodcast(VALID_POST_ID, '?locale=xx')
      expect(res.status).toBe(400)
    })

    it('rejects a non-UUID postId with 400', async () => {
      const res = await getPodcast('not-a-uuid', '?locale=en')
      expect(res.status).toBe(400)
    })

    it('returns 404 for a post that is not published (draft)', async () => {
      mocks.publishedPost = null
      const res = await getPodcast(VALID_POST_ID, '?locale=en')
      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.exists).toBe(false)
    })

    it('returns exists+audioUrl for a published post with a completed podcast (audio-player.tsx read path)', async () => {
      mocks.podcastRow = {
        audio_url: 'https://blob.example/podcast.mp3',
        status: 'completed',
        duration_seconds: 1234,
        created_at: '2026-01-01T00:00:00Z',
      }
      const res = await getPodcast(VALID_POST_ID, '?locale=en')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.exists).toBe(true)
      expect(data.audioUrl).toBe('https://blob.example/podcast.mp3')
      expect(mocks.podcastWrite).not.toHaveBeenCalled()
    })

    it('defaults to locale=de and reports status=generating without writing', async () => {
      mocks.podcastRow = {
        audio_url: null,
        status: 'generating',
        duration_seconds: null,
        created_at: '2026-01-01T00:00:00Z',
      }
      const res = await getPodcast(VALID_POST_ID)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.exists).toBe(false)
      expect(data.status).toBe('generating')
      expect(mocks.podcastWrite).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/podcast/[postId] (admin-only generation)', () => {
    it('rejects a request without a valid admin session with 401', async () => {
      const res = await postPodcast(VALID_POST_ID, { locale: 'en' })
      expect(res.status).toBe(401)
      expect(mocks.podcastWrite).not.toHaveBeenCalled()
    })

    it('rejects a non-UUID postId with 400 even with a valid session', async () => {
      mocks.session = { isAdmin: true }
      const res = await postPodcast('not-a-uuid', { locale: 'en' })
      expect(res.status).toBe(400)
      expect(mocks.podcastWrite).not.toHaveBeenCalled()
    })

    it('rejects an unsupported locale with 400 even with a valid session', async () => {
      mocks.session = { isAdmin: true }
      const res = await postPodcast(VALID_POST_ID, { locale: 'xx' })
      expect(res.status).toBe(400)
      expect(mocks.podcastWrite).not.toHaveBeenCalled()
    })

    it('rejects unknown body fields (strict schema) with 400', async () => {
      mocks.session = { isAdmin: true }
      const res = await postPodcast(VALID_POST_ID, { locale: 'en', evil: 'dropall' })
      expect(res.status).toBe(400)
      expect(mocks.podcastWrite).not.toHaveBeenCalled()
    })
  })
})
