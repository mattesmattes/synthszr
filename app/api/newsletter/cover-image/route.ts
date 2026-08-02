import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { parseIntParam } from '@/lib/validation/query-params'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fetchNewsletterImage, ImageFetchError } from '@/lib/security/safe-image-fetch'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

// Neon yellow RGB values
const NEON_YELLOW = { r: 204, g: 255, b: 0 }

// SEC-007: input decode limit for sharp — matches the 16 MP cap enforced on
// every sharp() instantiation that decodes the untrusted fetched bytes.
const MAX_INPUT_PIXELS = 16_000_000

const relaxedLimiter = rateLimiters.relaxed()

function errorResponse(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * GET /api/newsletter/cover-image
 * Returns a 1:1 center-cropped version of the cover image for newsletters
 * Converts dithered B&W images to black on neon yellow background
 *
 * Query params:
 * - url: The original image URL
 * - size: Output size in pixels (default: 1104 = 2x display size for sharp dithering at 552px)
 * - logo: If 'true', adds the Synthszr logo overlay centered on the image
 * - playButton: If 'true', adds a play button overlay in the center (legacy)
 * - skipTransform: If 'true', skips color transformation (for already-processed images)
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
    const size = parseIntParam(searchParams.get('size'), 1104, 100, 4000)
    const addLogo = searchParams.get('logo') === 'true'
    const addPlayButton = searchParams.get('playButton') === 'true'
    const skipTransform = searchParams.get('skipTransform') === 'true'

    if (!imageUrl) {
      return errorResponse({ error: 'Missing url parameter' }, 400)
    }

    // SEC-007: bounded, SSRF-safe fetch — exact hostname allowlist (incl.
    // redirects), 10s timeout, 3 redirects, 8 MiB download cap, MIME +
    // magic-byte check restricted to PNG/JPEG/WebP.
    let imageBuffer: Buffer
    try {
      imageBuffer = await fetchNewsletterImage(imageUrl)
    } catch (err) {
      if (err instanceof ImageFetchError) {
        return errorResponse({ error: err.message }, err.status)
      }
      throw err
    }

    // Get image metadata — bounded to 16 MP; sharp throws before decoding
    // pixel data if the input exceeds this, which we map to 422 below.
    let width: number | undefined
    let height: number | undefined
    try {
      const metadata = await sharp(imageBuffer, {
        failOn: 'warning',
        limitInputPixels: MAX_INPUT_PIXELS,
        sequentialRead: true,
      }).metadata()
      ;({ width, height } = metadata)
    } catch {
      return errorResponse({ error: 'Image exceeds processing limits' }, 422)
    }

    if (!width || !height) {
      return errorResponse({ error: 'Invalid image' }, 400)
    }

    // Calculate center crop for 1:1 aspect ratio
    const cropSize = Math.min(width, height)
    const left = Math.floor((width - cropSize) / 2)
    const top = Math.floor((height - cropSize) / 2)

    let finalImage: Buffer

    try {
      if (skipTransform) {
        // Skip color transformation - just crop and resize (for already-processed images)
        finalImage = await sharp(imageBuffer, {
          failOn: 'warning',
          limitInputPixels: MAX_INPUT_PIXELS,
          sequentialRead: true,
        })
          .extract({ left, top, width: cropSize, height: cropSize })
          .resize(size, size, { fit: 'fill', kernel: sharp.kernel.nearest })
          .png()
          .toBuffer()
      } else {
        // Full processing with color transformation
        // Use nearest-neighbor to preserve dithered B&W dots (lanczos3 creates gray values)
        const croppedBuffer = await sharp(imageBuffer, {
          failOn: 'warning',
          limitInputPixels: MAX_INPUT_PIXELS,
          sequentialRead: true,
        })
          .extract({ left, top, width: cropSize, height: cropSize })
          .resize(size, size, { fit: 'fill', kernel: sharp.kernel.nearest })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })

        const { data, info } = croppedBuffer

        // Process pixels: white/transparent → neon yellow, dark → black
        // This recreates the frontend effect (yellow BG + transparent PNG overlay)
        const pixels = new Uint8Array(data)
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i]
          const g = pixels[i + 1]
          const b = pixels[i + 2]
          const a = pixels[i + 3]

          // Calculate luminance
          const luminance = (r + g + b) / 3

          // If pixel is transparent OR bright (white in dithered image) → neon yellow
          // If pixel is dark (black in dithered image) → pure black
          const threshold = 128
          if (a < 128 || luminance >= threshold) {
            // White/transparent → neon yellow
            pixels[i] = NEON_YELLOW.r
            pixels[i + 1] = NEON_YELLOW.g
            pixels[i + 2] = NEON_YELLOW.b
            pixels[i + 3] = 255
          } else {
            // Dark → pure black
            pixels[i] = 0
            pixels[i + 1] = 0
            pixels[i + 2] = 0
            pixels[i + 3] = 255
          }
        }

        // Create base image from processed pixels
        finalImage = await sharp(Buffer.from(pixels), {
          raw: {
            width: info.width,
            height: info.height,
            channels: 4,
          },
        })
          .png()
          .toBuffer()
      }
    } catch {
      return errorResponse({ error: 'Image exceeds processing limits' }, 422)
    }

    // Add logo overlay if requested
    if (addLogo) {
      const logoSvgRaw = readFileSync(join(process.cwd(), 'public', 'synthszr-logo.svg'), 'utf-8')
      // Original viewBox: 0 0 464.93 103.82 → aspect ratio ~4.475
      const logoWidth = Math.round(size * 0.80)
      const logoHeight = Math.round(logoWidth / 4.475)
      // Replace viewBox-only SVG with explicit width/height for sharp
      const logoSvg = logoSvgRaw
        .replace(/<svg([^>]*)>/, `<svg$1 width="${logoWidth}" height="${logoHeight}">`)

      finalImage = await sharp(finalImage)
        .composite([
          {
            input: Buffer.from(logoSvg),
            top: Math.round((size - logoHeight) / 2),
            left: Math.round((size - logoWidth) / 2),
          },
        ])
        .png()
        .toBuffer()
    }

    // Add play button overlay if requested (legacy)
    if (addPlayButton) {
      // Scale play button to image size (80px at 302px = ~26% of image)
      const buttonSize = Math.round(size * 0.26)
      const circleRadius = Math.round(buttonSize * 0.45)

      const playButtonSvg = `
        <svg width="${buttonSize}" height="${buttonSize}" viewBox="0 0 ${buttonSize} ${buttonSize}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.3"/>
            </filter>
            <!-- Mask to cut out the triangle from the circle -->
            <mask id="playMask">
              <circle cx="${buttonSize / 2}" cy="${buttonSize / 2}" r="${circleRadius}" fill="white"/>
              <polygon points="${buttonSize * 0.38},${buttonSize * 0.28} ${buttonSize * 0.38},${buttonSize * 0.72} ${buttonSize * 0.72},${buttonSize * 0.5}" fill="black"/>
            </mask>
          </defs>
          <!-- White circle with triangle cut out -->
          <circle cx="${buttonSize / 2}" cy="${buttonSize / 2}" r="${circleRadius}" fill="rgba(255,255,255,0.95)" filter="url(#shadow)" mask="url(#playMask)"/>
        </svg>
      `

      finalImage = await sharp(finalImage)
        .composite([
          {
            input: Buffer.from(playButtonSvg),
            top: Math.round((size - buttonSize) / 2),
            left: Math.round((size - buttonSize) / 2),
          },
        ])
        .png()
        .toBuffer()
    }

    // Return the final image with short cache (for development)
    return new NextResponse(new Uint8Array(finalImage), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    console.error('[Cover Image] Error:', error)
    return errorResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
}
