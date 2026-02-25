import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { readFileSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

const COVER_SIZE = 1400
// Neon green: #00FF00
const NEON_GREEN = { r: 0, g: 255, b: 0 }

/**
 * GET /api/podcast/cover-image?postId=xxx
 * Generates a 1400x1400 podcast cover image:
 * - Fetches the post's cover image
 * - Converts to dithered B&W (threshold at 128)
 * - Colors bright pixels neon green, dark pixels black
 * - Overlays white Synthszr logo centered
 * - Returns PNG with Content-Disposition: attachment
 */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const postId = searchParams.get('postId')

  if (!postId) {
    return NextResponse.json({ error: 'Missing postId parameter' }, { status: 400 })
  }

  try {
    const supabase = createAdminClient()

    // Fetch post with cover image URL via join
    const { data: post } = await supabase
      .from('generated_posts')
      .select('id, title, post_images!cover_image_id(image_url)')
      .eq('id', postId)
      .single()

    if (!post) {
      return NextResponse.json({ error: 'Post nicht gefunden' }, { status: 404 })
    }

    // post_images is joined via foreign key — may be object or array
    const postImages = post.post_images as { image_url: string } | { image_url: string }[] | null
    const imageUrl = Array.isArray(postImages)
      ? postImages[0]?.image_url
      : postImages?.image_url

    if (!imageUrl) {
      return NextResponse.json({ error: 'Kein Cover-Bild für diesen Post' }, { status: 404 })
    }

    // Fetch the source image
    const imgResponse = await fetch(imageUrl)
    if (!imgResponse.ok) {
      return NextResponse.json({ error: 'Cover-Bild konnte nicht geladen werden' }, { status: 502 })
    }

    const imageBuffer = Buffer.from(await imgResponse.arrayBuffer())

    // Get metadata for center-crop calculation
    const metadata = await sharp(imageBuffer).metadata()
    const { width, height } = metadata
    if (!width || !height) {
      return NextResponse.json({ error: 'Ungültiges Bild' }, { status: 400 })
    }

    // Center-crop to 1:1, resize to 1400×1400 (nearest-neighbor preserves dither pattern)
    const cropSize = Math.min(width, height)
    const left = Math.floor((width - cropSize) / 2)
    const top = Math.floor((height - cropSize) / 2)

    const { data, info } = await sharp(imageBuffer)
      .extract({ left, top, width: cropSize, height: cropSize })
      .resize(COVER_SIZE, COVER_SIZE, { fit: 'fill', kernel: sharp.kernel.nearest })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    // Color transform: bright/transparent → neon green, dark → pure black
    const pixels = new Uint8Array(data)
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]
      const g = pixels[i + 1]
      const b = pixels[i + 2]
      const a = pixels[i + 3]
      const luminance = (r + g + b) / 3

      if (a < 128 || luminance >= 128) {
        pixels[i] = NEON_GREEN.r
        pixels[i + 1] = NEON_GREEN.g
        pixels[i + 2] = NEON_GREEN.b
        pixels[i + 3] = 255
      } else {
        pixels[i] = 0
        pixels[i + 1] = 0
        pixels[i + 2] = 0
        pixels[i + 3] = 255
      }
    }

    // Build base image from processed pixels
    let finalImage = await sharp(Buffer.from(pixels), {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer()

    // Overlay white Synthszr logo (SVG is already white: fill: #fff)
    const logoSvgRaw = readFileSync(join(process.cwd(), 'public', 'synthszr-logo.svg'), 'utf-8')
    // Logo viewBox: 0 0 464.93 103.82 → aspect ratio ~4.475:1
    const logoWidth = Math.round(COVER_SIZE * 0.65)
    const logoHeight = Math.round(logoWidth / 4.475)
    const logoSvg = logoSvgRaw.replace(
      /<svg([^>]*)>/,
      `<svg$1 width="${logoWidth}" height="${logoHeight}">`
    )

    finalImage = await sharp(finalImage)
      .composite([
        {
          input: Buffer.from(logoSvg),
          top: Math.round((COVER_SIZE - logoHeight) / 2),
          left: Math.round((COVER_SIZE - logoWidth) / 2),
        },
      ])
      .png()
      .toBuffer()

    return new NextResponse(new Uint8Array(finalImage), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment; filename="synthszr-podcast-cover.png"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[Podcast Cover] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unbekannter Fehler' },
      { status: 500 }
    )
  }
}
