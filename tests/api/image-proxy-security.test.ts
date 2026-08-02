import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import sharp from 'sharp'

// --- Mocks --------------------------------------------------------------
// vi.mock factories are hoisted above imports; only vi.hoisted()-created
// bindings (or identifiers starting with "mock") may be referenced inside
// them, so all shared mock state lives in `mocks`.
//
// Rate limiting is mocked exactly like tests/api/analytics-security.test.ts.
// The actual network fetch (inside lib/security/ssrf.ts's safeFetch) is
// replaced with a controllable stub via vi.stubGlobal — everything ABOVE
// that (hostname allowlist, redirect-following, private-IP guard, MIME/
// magic-byte check, 8 MiB cap) runs for real, including real DNS lookups
// for the allowlisted hostnames (same convention as tests/lib/ssrf.test.ts,
// which resolves example.com for real).

const mocks = vi.hoisted(() => ({
  rateLimit: { success: true },
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

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { GET as coverImageHandler } from '@/app/api/newsletter/cover-image/route'
import { GET as thumbnailImageHandler } from '@/app/api/newsletter/thumbnail-image/route'
import { NEWSLETTER_IMAGE_HOSTS } from '@/lib/security/safe-image-fetch'

// --- Helpers --------------------------------------------------------------

const ALLOWED_HOST = NEWSLETTER_IMAGE_HOSTS[0] // lbrzdn804nhy3kox.public.blob.vercel-storage.com
const ALLOWED_URL = `https://${ALLOWED_HOST}/image.png`
const DISALLOWED_URL = 'https://evil.example/image.png'

async function getCoverImage(query: string) {
  const req = new NextRequest(`http://localhost/api/newsletter/cover-image${query}`)
  return coverImageHandler(req)
}

async function getThumbnailImage(query: string) {
  const req = new NextRequest(`http://localhost/api/newsletter/thumbnail-image${query}`)
  return thumbnailImageHandler(req)
}

function pngResponse(buffer: Buffer, extraHeaders: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(buffer), { status: 200, headers: { 'content-type': 'image/png', ...extraHeaders } })
}

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toBuffer()
}

let smallPng: Buffer
let oversizedPixelPng: Buffer // > 16 megapixels

beforeEach(async () => {
  mocks.rateLimit.success = true
  mockFetch.mockReset()
  if (!smallPng) smallPng = await makePng(20, 20)
  if (!oversizedPixelPng) oversizedPixelPng = await makePng(4100, 4000) // 16.4 MP > 16 MP limit
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('Newsletter image proxy security (SEC-007)', () => {
  describe('/api/newsletter/cover-image', () => {
    it('returns 429 when the rate limit is exceeded, before ever fetching', async () => {
      mocks.rateLimit.success = false
      const res = await getCoverImage(`?url=${encodeURIComponent(ALLOWED_URL)}`)
      expect(res.status).toBe(429)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns 400 when the url parameter is missing', async () => {
      const res = await getCoverImage('')
      expect(res.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns 403 for a host not on the allowlist, without ever fetching', async () => {
      const res = await getCoverImage(`?url=${encodeURIComponent(DISALLOWED_URL)}`)
      expect(res.status).toBe(403)
      expect(mockFetch).not.toHaveBeenCalled()
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    })

    it('returns 403 when a redirect points to a non-allowlisted host', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: DISALLOWED_URL } })
      )
      const res = await getCoverImage(`?url=${encodeURIComponent(ALLOWED_URL)}`)
      expect(res.status).toBe(403)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('returns 413 when the declared Content-Length exceeds 8 MiB', async () => {
      mockFetch.mockResolvedValueOnce(
        pngResponse(smallPng, { 'content-length': String(9 * 1024 * 1024) })
      )
      const res = await getCoverImage(`?url=${encodeURIComponent(ALLOWED_URL)}`)
      expect(res.status).toBe(413)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    })

    it('returns 413 for a streamed body exceeding 8 MiB with no Content-Length header', async () => {
      const chunk = new Uint8Array(1024 * 1024).fill(1) // 1 MiB
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < 9; i++) controller.enqueue(chunk) // 9 MiB total
          controller.close()
        },
      })
      mockFetch.mockResolvedValueOnce(new Response(stream, { status: 200, headers: { 'content-type': 'image/png' } }))
      const res = await getCoverImage(`?url=${encodeURIComponent(ALLOWED_URL)}`)
      expect(res.status).toBe(413)
    })

    it('returns 415 when Content-Type and magic bytes disagree', async () => {
      // Real PNG bytes, but declared as JPEG.
      mockFetch.mockResolvedValueOnce(new Response(new Uint8Array(smallPng), { status: 200, headers: { 'content-type': 'image/jpeg' } }))
      const res = await getCoverImage(`?url=${encodeURIComponent(ALLOWED_URL)}`)
      expect(res.status).toBe(415)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    })

    it('returns 415 for an unsupported format (GIF) even with a matching Content-Type', async () => {
      const gifBytes = Buffer.from('GIF89a' + 'x'.repeat(20))
      mockFetch.mockResolvedValueOnce(new Response(new Uint8Array(gifBytes), { status: 200, headers: { 'content-type': 'image/gif' } }))
      const res = await getCoverImage(`?url=${encodeURIComponent(ALLOWED_URL)}`)
      expect(res.status).toBe(415)
    })

    it('returns 422 for an image exceeding 16 megapixels', async () => {
      mockFetch.mockResolvedValueOnce(pngResponse(oversizedPixelPng))
      const res = await getCoverImage(`?url=${encodeURIComponent(ALLOWED_URL)}`)
      expect(res.status).toBe(422)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    })

    it('returns 200 with a public cache header for a valid image within all limits', async () => {
      mockFetch.mockResolvedValueOnce(pngResponse(smallPng))
      const res = await getCoverImage(`?url=${encodeURIComponent(ALLOWED_URL)}&size=100`)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('image/png')
      expect(res.headers.get('Cache-Control')).toMatch(/^public/)
    })
  })

  describe('/api/newsletter/thumbnail-image', () => {
    it('returns 429 when the rate limit is exceeded, before ever fetching', async () => {
      mocks.rateLimit.success = false
      const res = await getThumbnailImage(`?url=${encodeURIComponent(ALLOWED_URL)}`)
      expect(res.status).toBe(429)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns 403 for a host not on the allowlist', async () => {
      const res = await getThumbnailImage(`?url=${encodeURIComponent(DISALLOWED_URL)}`)
      expect(res.status).toBe(403)
      expect(mockFetch).not.toHaveBeenCalled()
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    })

    it('returns 413 when the declared Content-Length exceeds 8 MiB', async () => {
      mockFetch.mockResolvedValueOnce(pngResponse(smallPng, { 'content-length': String(9 * 1024 * 1024) }))
      const res = await getThumbnailImage(`?url=${encodeURIComponent(ALLOWED_URL)}&bg=00FF00`)
      expect(res.status).toBe(413)
    })

    it('returns 415 when Content-Type and magic bytes disagree', async () => {
      mockFetch.mockResolvedValueOnce(new Response(new Uint8Array(smallPng), { status: 200, headers: { 'content-type': 'image/webp' } }))
      const res = await getThumbnailImage(`?url=${encodeURIComponent(ALLOWED_URL)}&bg=00FF00`)
      expect(res.status).toBe(415)
    })

    it('returns 422 for an image exceeding 16 megapixels', async () => {
      mockFetch.mockResolvedValueOnce(pngResponse(oversizedPixelPng))
      const res = await getThumbnailImage(`?url=${encodeURIComponent(ALLOWED_URL)}&bg=00FF00`)
      expect(res.status).toBe(422)
    })

    it('returns 200 with a public cache header for a valid image within all limits', async () => {
      mockFetch.mockResolvedValueOnce(pngResponse(smallPng))
      const res = await getThumbnailImage(`?url=${encodeURIComponent(ALLOWED_URL)}&bg=00FF00`)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('image/png')
      expect(res.headers.get('Cache-Control')).toMatch(/^public/)
    })

    it('caps output at 1200x1200 even if the source metadata reports a larger width', async () => {
      // 1600x1600 is under the 16 MP decode limit (2.56 MP) but over the 1200 output cap.
      const wideButAllowedPng = await makePng(1600, 1600)
      mockFetch.mockResolvedValueOnce(pngResponse(wideButAllowedPng))
      const res = await getThumbnailImage(`?url=${encodeURIComponent(ALLOWED_URL)}&bg=00FF00`)
      expect(res.status).toBe(200)
      const buf = Buffer.from(await res.arrayBuffer())
      const meta = await sharp(buf).metadata()
      expect(meta.width).toBeLessThanOrEqual(1200)
      expect(meta.height).toBeLessThanOrEqual(1200)
    })
  })
})
