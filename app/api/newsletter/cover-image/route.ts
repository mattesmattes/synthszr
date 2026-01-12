import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

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
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const imageUrl = searchParams.get('url')
    const size = parseInt(searchParams.get('size') || '1104')

    if (!imageUrl) {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
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

    // Crop to square and resize first
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

    // Create final image
    const finalImage = await sharp(Buffer.from(pixels), {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
    })
      .png()
      .toBuffer()

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
