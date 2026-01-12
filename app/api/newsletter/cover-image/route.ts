import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

/**
 * GET /api/newsletter/cover-image
 * Returns a 1:1 center-cropped version of the cover image for newsletters
 *
 * Query params:
 * - url: The original image URL
 * - size: Output size in pixels (default: 600)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const imageUrl = searchParams.get('url')
    const size = parseInt(searchParams.get('size') || '600')

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

    // Crop to square and resize, then flatten with yellow background
    const finalImage = await sharp(imageBuffer)
      .extract({ left, top, width: cropSize, height: cropSize })
      .resize(size, size, { fit: 'fill' })
      .flatten({ background: { r: 204, g: 255, b: 0 } }) // #CCFF00 neon yellow
      .png()
      .toBuffer()

    // Return the final image with caching headers
    return new NextResponse(new Uint8Array(finalImage), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
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
