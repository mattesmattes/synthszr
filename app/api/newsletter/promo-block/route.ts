import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { readFileSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

/**
 * GET /api/newsletter/promo-block
 *
 * Returns a pre-composited PNG of podcast badges in a single horizontal
 * row — Apple Podcasts on the left, Spotify on the right (white background
 * baked in for dark-mode-safe rendering across email clients).
 *
 * Layout (@2x retina, displayed at 600px wide in email):
 *   - 2 badge images, 144px tall, centered horizontally with a wide gap.
 *
 * History note: previously rendered a 2x2 grid that also included
 * YouTube and Audible. Removed per Mattes — distribution to those
 * platforms is now handled separately, the email focuses on the two
 * main listening apps.
 */
export async function GET() {
  try {
    const W = 1200
    const BADGE_H = 144
    const PAD_TOP = 32
    const PAD_BOT = 32
    const GAP_X = 96 // generous gap between Apple and Spotify

    // Load badge images from public folder
    const appleBuf = readFileSync(join(process.cwd(), 'public', 'podcast-apple.png'))
    const spotifyBuf = readFileSync(join(process.cwd(), 'public', 'podcast-spotify.png'))

    // Resize each badge to BADGE_H tall (preserve aspect ratio)
    const resizeBadge = async (buf: Buffer) => {
      const meta = await sharp(buf).metadata()
      const w = Math.round((meta.width! / meta.height!) * BADGE_H)
      const resized = await sharp(buf)
        .resize(w, BADGE_H, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer()
      return { buf: resized, w }
    }

    const [apple, spotify] = await Promise.all([
      resizeBadge(Buffer.from(appleBuf)),
      resizeBadge(Buffer.from(spotifyBuf)),
    ])

    // Center the row horizontally
    const rowW = apple.w + GAP_X + spotify.w
    const rowLeft = Math.round((W - rowW) / 2)
    const rowTop = PAD_TOP

    // Total canvas height
    const H = PAD_TOP + BADGE_H + PAD_BOT

    // Composite badges onto a white background
    const result = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        { input: apple.buf, top: rowTop, left: rowLeft },
        { input: spotify.buf, top: rowTop, left: rowLeft + apple.w + GAP_X },
      ])
      .png({ compressionLevel: 6 })
      .toBuffer()

    return new NextResponse(new Uint8Array(result), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400', // 1 day
      },
    })
  } catch (error) {
    console.error('[Promo Block] Error:', error)
    return new NextResponse('Image generation failed', { status: 500 })
  }
}
