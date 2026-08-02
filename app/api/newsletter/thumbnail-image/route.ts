import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { fetchNewsletterImage, ImageFetchError } from '@/lib/security/safe-image-fetch'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// SEC-007: input decode limit for sharp — matches the 16 MP cap enforced on
// every sharp() instantiation that decodes the untrusted fetched bytes.
const MAX_INPUT_PIXELS = 16_000_000
// Output is capped independently of the source image's size.
const MAX_OUTPUT_SIZE = 1200

const relaxedLimiter = rateLimiters.relaxed()

function errorResponse(body: string, status: number): NextResponse {
  return new NextResponse(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * GET /api/newsletter/thumbnail-image
 * Composites a transparent dithered thumbnail PNG onto a solid vote-color background.
 * Used exclusively for newsletter emails to prevent dark-mode clients from
 * inverting or overriding the CSS background-color fallback.
 *
 * Query params:
 * - url: The Vercel Blob URL of the transparent thumbnail PNG
 * - bg:  Background hex color without # (e.g. "00FF00")
 */
export async function GET(request: NextRequest) {
  try {
    // Rate limit first — a blocked request never fetches or processes anything.
    const ip = getClientIP(request)
    const rateLimit = await checkRateLimit(`newsletter-image:${ip}`, relaxedLimiter ?? undefined)
    if (!rateLimit.success) {
      const res = rateLimitResponse(rateLimit)
      res.headers.set('Cache-Control', 'no-store')
      return res
    }

    const { searchParams } = new URL(request.url)
    const imageUrl = searchParams.get('url')
    const bgHex = searchParams.get('bg') || '00FFFF'

    if (!imageUrl) {
      return errorResponse('url param required', 400)
    }

    // SEC-007: bounded, SSRF-safe fetch — exact hostname allowlist (incl.
    // redirects), 10s timeout, 3 redirects, 8 MiB download cap, MIME +
    // magic-byte check restricted to PNG/JPEG/WebP.
    let imageBuffer: Buffer
    try {
      imageBuffer = await fetchNewsletterImage(imageUrl)
    } catch (err) {
      if (err instanceof ImageFetchError) {
        return errorResponse(err.message, err.status)
      }
      throw err
    }

    // Parse background hex → RGB
    const hex = bgHex.replace('#', '').padEnd(6, '0')
    const bgR = parseInt(hex.slice(0, 2), 16)
    const bgG = parseInt(hex.slice(2, 4), 16)
    const bgB = parseInt(hex.slice(4, 6), 16)

    let size: number
    let resizedOverlay: Buffer
    try {
      const meta = await sharp(imageBuffer, {
        failOn: 'warning',
        limitInputPixels: MAX_INPUT_PIXELS,
        sequentialRead: true,
      }).metadata()
      // Cap the output independently of the source's actual dimensions —
      // resize (not just clamp the background) so an oversized overlay
      // never fails sharp's composite() ("must have same dimensions or
      // smaller than image to composite onto").
      size = Math.min(meta.width || 604, MAX_OUTPUT_SIZE)
      resizedOverlay = await sharp(imageBuffer, {
        failOn: 'warning',
        limitInputPixels: MAX_INPUT_PIXELS,
        sequentialRead: true,
      })
        .resize(size, size, { fit: 'fill' })
        .toBuffer()
    } catch {
      return errorResponse('Image exceeds processing limits', 422)
    }

    // Build solid-color background
    const bgBuffer = await sharp({
      create: { width: size, height: size, channels: 3, background: { r: bgR, g: bgG, b: bgB } },
    })
      .png()
      .toBuffer()

    // Composite transparent PNG over background → opaque PNG
    const result = await sharp(bgBuffer)
      .composite([{ input: resizedOverlay, blend: 'over' }])
      .png()
      .toBuffer()

    return new NextResponse(new Uint8Array(result), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400', // 24h cache
      },
    })
  } catch (error) {
    console.error('[Newsletter Thumbnail] Error:', error)
    return errorResponse('Image processing failed', 500)
  }
}
