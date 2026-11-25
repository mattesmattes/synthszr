import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import sharp from 'sharp'

const mocks = vi.hoisted(() => ({
  fetchNewsletterImage: vi.fn(),
}))

vi.mock('@/lib/security/safe-image-fetch', () => ({
  fetchNewsletterImage: mocks.fetchNewsletterImage,
  ImageFetchError: class ImageFetchError extends Error {
    constructor(message: string, public status: number) {
      super(message)
    }
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimiters: { relaxed: () => null },
  getClientIP: () => '127.0.0.1',
  checkRateLimit: vi.fn(async () => ({ success: true, remaining: 99, reset: Date.now() + 60_000, limit: 100 })),
  rateLimitResponse: vi.fn(),
}))

import { GET } from '@/app/api/newsletter/cover-image/route'

describe('GET /api/newsletter/cover-image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('erhält native 792x792 Dither-Auflösung bei size=900 ohne Verzerrung und färbt auf Neon-Cyan (#00FFFF)', async () => {
    const w = 1408
    const h = 792
    const raw = Buffer.alloc(w * h * 4)
    // Checkerboard 1-bit dither: alternating opaque black (0,0,0,255) & transparent (0,0,0,0)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4
        const isBlack = (x + y) % 2 === 0
        raw[idx] = 0
        raw[idx + 1] = 0
        raw[idx + 2] = 0
        raw[idx + 3] = isBlack ? 255 : 0
      }
    }
    const pngBuf = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
    mocks.fetchNewsletterImage.mockResolvedValueOnce(pngBuf)

    const req = new NextRequest(
      'http://localhost/api/newsletter/cover-image?url=https%3A%2F%2Flbrzdn804nhy3kox.public.blob.vercel-storage.com%2Fpost-images%2Ftest%2Fcover.png&size=900&logo=true'
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')

    const outBuf = Buffer.from(await res.arrayBuffer())
    const meta = await sharp(outBuf).metadata()
    // Preserves native cropSize=792 instead of nearest-neighbor upscaling 792→900
    expect(meta.width).toBe(792)
    expect(meta.height).toBe(792)

    const { data } = await sharp(outBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let cyanPixels = 0
    let blackPixels = 0
    let legacyYellowPixels = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (r === 0 && g === 255 && b === 255) cyanPixels++
      else if (r === 0 && g === 0 && b === 0) blackPixels++
      else if (r === 204 && g === 255 && b === 0) legacyYellowPixels++
    }
    expect(cyanPixels).toBeGreaterThan(100_000)
    expect(blackPixels).toBeGreaterThan(100_000)
    expect(legacyYellowPixels).toBe(0)
  })
})
