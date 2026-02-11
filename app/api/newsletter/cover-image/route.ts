import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { parseIntParam } from '@/lib/validation/query-params'
import { readFileSync } from 'fs'
import { join } from 'path'

// Neon yellow RGB values
const NEON_YELLOW = { r: 204, g: 255, b: 0 }

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
    const { searchParams } = new URL(request.url)
    const imageUrl = searchParams.get('url')
    const size = parseIntParam(searchParams.get('size'), 1104, 100, 4000)
    const addLogo = searchParams.get('logo') === 'true'
    const addPlayButton = searchParams.get('playButton') === 'true'
    const skipTransform = searchParams.get('skipTransform') === 'true'

    if (!imageUrl) {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
    }

    // SSRF protection: only allow HTTPS URLs from trusted image hosts
    let parsedUrl: URL
    try {
      parsedUrl = new URL(imageUrl)
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    if (parsedUrl.protocol !== 'https:') {
      return NextResponse.json({ error: 'Only HTTPS URLs allowed' }, { status: 400 })
    }

    const allowedHosts = [
      'supabase.co',
      'supabase.com',
      'githubusercontent.com',
      'unsplash.com',
      'images.unsplash.com',
      'synthszr.com',
      'vercel.app',
      'vercel-storage.com',
    ]
    const isAllowedHost = allowedHosts.some(host => parsedUrl.hostname.endsWith(host))
    if (!isAllowedHost) {
      return NextResponse.json({ error: 'Image host not allowed' }, { status: 403 })
    }

    // Fetch the original image
    const response = await fetch(imageUrl)
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch image' }, { status: 502 })
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer())

    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata()
    const { width, height } = metadata

    if (!width || !height) {
      return NextResponse.json({ error: 'Invalid image' }, { status: 400 })
    }

    // Calculate center crop for 1:1 aspect ratio
    const cropSize = Math.min(width, height)
    const left = Math.floor((width - cropSize) / 2)
    const top = Math.floor((height - cropSize) / 2)

    let finalImage: Buffer

    if (skipTransform) {
      // Skip color transformation - just crop and resize (for already-processed images)
      finalImage = await sharp(imageBuffer)
        .extract({ left, top, width: cropSize, height: cropSize })
        .resize(size, size, { fit: 'fill' })
        .png()
        .toBuffer()
    } else {
      // Full processing with color transformation
      const croppedBuffer = await sharp(imageBuffer)
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

    // Add logo overlay if requested
    if (addLogo) {
      const logoSvgRaw = readFileSync(join(process.cwd(), 'public', 'synthszr-logo.svg'), 'utf-8')
      // Original viewBox: 0 0 464.93 103.82 → aspect ratio ~4.475
      const logoWidth = Math.round(size * 0.65)
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
