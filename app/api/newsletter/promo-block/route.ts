import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { readFileSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

/**
 * GET /api/newsletter/promo-block
 * Returns a pre-composited PNG of the podcast badge row
 * (white background baked in — dark-mode-safe for all email clients).
 * Headline text is now rendered as HTML in the email template.
 *
 * Layout (@2x retina, displayed at 600px wide in email):
 *   - 4 badge images → 72px tall each, inline with 16px gaps, centered
 *     (Apple, Spotify, YouTube, Audible)
 */
export async function GET() {
  try {
    const W = 1200
    const BADGE_H = 72
    const PAD_TOP = 12
    const PAD_BOT = 32
    const GAP_BADGES = 16

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

    // Total width of badge row
    const badgesW = apple.w + GAP_BADGES + spotify.w + GAP_BADGES + youtube.w + GAP_BADGES + audible.w
    const badgesLeft = Math.round((W - badgesW) / 2)

    // Total canvas height
    const H = PAD_TOP + BADGE_H + PAD_BOT
    const badgesTop = PAD_TOP

    let xOffset = badgesLeft

    // Composite badges onto a white background
    const result = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        { input: apple.buf,      top: badgesTop,  left: xOffset },
        { input: spotify.buf,    top: badgesTop,  left: xOffset += apple.w + GAP_BADGES },
        { input: youtube.buf,    top: badgesTop,  left: xOffset += spotify.w + GAP_BADGES },
        { input: audible.buf,    top: badgesTop,  left: xOffset += youtube.w + GAP_BADGES },
      ])
      .png({ compressionLevel: 6 })
      .toBuffer()

    return new NextResponse(new Uint8Array(result), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=604800', // 7 days (static content)
      },
    })
  } catch (error) {
    console.error('[Promo Block] Error:', error)
    return new NextResponse('Image generation failed', { status: 500 })
  }
}
