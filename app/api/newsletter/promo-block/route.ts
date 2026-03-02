import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { readFileSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

/**
 * GET /api/newsletter/promo-block
 * Returns a pre-composited 1200×260px PNG of the podcast promo section
 * (white background baked in — dark-mode-safe for all email clients).
 *
 * Layout (@2x retina, displayed at 600×130px in email):
 *   - podcast_hl.png  → 600px wide, centered, 24px top margin
 *   - 3 badge images  → 72px tall each, inline with 16px gaps, centered
 */
export async function GET() {
  try {
    // Canvas dimensions (@2x retina)
    const W = 1200
    const BADGE_H = 72      // 36px @2x
    const HL_W = 600        // 300px @2x
    const PAD_TOP = 32
    const PAD_BOT = 32
    const GAP_HL_BADGES = 24
    const GAP_BADGES = 16

    // Load source images from public folder
    const hlBuf      = readFileSync(join(process.cwd(), 'public', 'podcast_hl.png'))
    const spotifyBuf = readFileSync(join(process.cwd(), 'public', 'podcast_spotify.png'))
    const appleBuf   = readFileSync(join(process.cwd(), 'public', 'podcast_apple.png'))
    const szrBuf     = readFileSync(join(process.cwd(), 'public', 'podcast_synthszr.png'))

    // Resize headline to HL_W wide (preserve aspect ratio)
    const hlMeta = await sharp(hlBuf).metadata()
    const HL_H = Math.round((hlMeta.height! / hlMeta.width!) * HL_W)
    const hlResized = await sharp(hlBuf)
      .resize(HL_W, HL_H, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer()

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

    const [spotify, apple, szr] = await Promise.all([
      resizeBadge(Buffer.from(spotifyBuf)),
      resizeBadge(Buffer.from(appleBuf)),
      resizeBadge(Buffer.from(szrBuf)),
    ])

    // Total width of badge row
    const badgesW = spotify.w + GAP_BADGES + apple.w + GAP_BADGES + szr.w
    const badgesLeft = Math.round((W - badgesW) / 2)

    // Total canvas height
    const H = PAD_TOP + HL_H + GAP_HL_BADGES + BADGE_H + PAD_BOT

    // Positions
    const hlLeft = Math.round((W - HL_W) / 2)
    const hlTop  = PAD_TOP
    const badgesTop = PAD_TOP + HL_H + GAP_HL_BADGES

    // Composite all elements onto a white background
    const result = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        { input: hlResized,     top: hlTop,    left: hlLeft },
        { input: spotify.buf,   top: badgesTop, left: badgesLeft },
        { input: apple.buf,     top: badgesTop, left: badgesLeft + spotify.w + GAP_BADGES },
        { input: szr.buf,       top: badgesTop, left: badgesLeft + spotify.w + GAP_BADGES + apple.w + GAP_BADGES },
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
