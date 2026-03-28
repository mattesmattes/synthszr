import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { readFileSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

/**
 * GET /api/newsletter/promo-block
 * Returns a pre-composited PNG of podcast badges in a 2x2 grid
 * (white background baked in — dark-mode-safe for all email clients).
 *
 * Layout (@2x retina, displayed at 600px wide in email):
 *   - 4 badge images → 144px tall each, arranged 2x2 with gaps, centered
 *     Row 1: Apple, Spotify
 *     Row 2: YouTube, Audible
 */
export async function GET() {
  try {
    const W = 1200
    const BADGE_H = 144
    const PAD_TOP = 24
    const PAD_BOT = 24
    const GAP_X = 24
    const GAP_Y = 24

    // Load badge images from public folder
    const appleBuf   = readFileSync(join(process.cwd(), 'public', 'podcast-apple.png'))
    const spotifyBuf = readFileSync(join(process.cwd(), 'public', 'podcast-spotify.png'))
    const youtubeBuf = readFileSync(join(process.cwd(), 'public', 'podcast-youtube.png'))
    const audibleBuf = readFileSync(join(process.cwd(), 'public', 'podcast-audible.png'))

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

    const [apple, spotify, youtube, audible] = await Promise.all([
      resizeBadge(Buffer.from(appleBuf)),
      resizeBadge(Buffer.from(spotifyBuf)),
      resizeBadge(Buffer.from(youtubeBuf)),
      resizeBadge(Buffer.from(audibleBuf)),
    ])

    // 2x2 grid: center each row independently
    const row1W = apple.w + GAP_X + spotify.w
    const row2W = youtube.w + GAP_X + audible.w
    const row1Left = Math.round((W - row1W) / 2)
    const row2Left = Math.round((W - row2W) / 2)

    const row1Top = PAD_TOP
    const row2Top = PAD_TOP + BADGE_H + GAP_Y

    // Total canvas height
    const H = PAD_TOP + BADGE_H + GAP_Y + BADGE_H + PAD_BOT

    // Composite badges onto a white background
    const result = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        // Row 1: Apple, Spotify
        { input: apple.buf,   top: row1Top, left: row1Left },
        { input: spotify.buf, top: row1Top, left: row1Left + apple.w + GAP_X },
        // Row 2: YouTube, Audible
        { input: youtube.buf, top: row2Top, left: row2Left },
        { input: audible.buf, top: row2Top, left: row2Left + youtube.w + GAP_X },
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
