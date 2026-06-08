import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

export const runtime = 'nodejs'

/**
 * GET /api/newsletter/podcast-promo-text?headline=…&title=…&subtitle=…
 *
 * Renders the podcast tip-promo TEXT (headline + episode title + subtitle) as a
 * transparent PNG with black text, baked at 2× for Retina. The newsletter places
 * it over the gradient box.
 *
 * Why an image: Gmail iOS dark mode inverts CSS text colors (black → white) but
 * NOT the gradient background-image, so black HTML text turned white on the light
 * green box and became unreadable. Image pixels are immune to that inversion, so
 * the text stays black on green in every client/mode — same trick as the buttons.
 */

const W = 1040 // 2× of the ~520px content width
const PAD_X = 48
const USABLE = W - PAD_X * 2

// Approximate per-character width factor for the sans-serif used by librsvg.
function wrap(text: string, fontSize: number, letterSpacing = 0): string[] {
  const charW = fontSize * 0.54 + letterSpacing
  const maxChars = Math.max(1, Math.floor(USABLE / charW))
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (next.length <= maxChars) cur = next
    else {
      if (cur) lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;'
  )
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const headline = (sp.get('headline') || '').toUpperCase()
    const title = sp.get('title') || ''
    const subtitle = sp.get('subtitle') || ''

    const FONT = 'Helvetica, Arial, DejaVu Sans, sans-serif'
    // 2× sizes
    const H_SIZE = 24, H_LH = 30, H_LS = 3.4 // headline (bold, uppercase, tracked)
    const T_SIZE = 36, T_LH = 44 // title (bold)
    const S_SIZE = 30, S_LH = 38 // subtitle
    const GAP_AFTER_H = 14
    const GAP_AFTER_T = 8
    const PAD_TOP = 28, PAD_BOT = 28

    const hLines = wrap(headline, H_SIZE, H_LS)
    const tLines = title ? wrap(title, T_SIZE) : []
    const sLines = subtitle ? wrap(subtitle, S_SIZE) : []

    let y = PAD_TOP
    const els: string[] = []
    const cx = W / 2

    for (const line of hLines) {
      y += H_SIZE
      els.push(`<text x="${cx}" y="${y}" font-family="${FONT}" font-size="${H_SIZE}" font-weight="700" letter-spacing="${H_LS}" fill="#000000" text-anchor="middle">${escapeXml(line)}</text>`)
      y += H_LH - H_SIZE
    }
    if (tLines.length) y += GAP_AFTER_H
    for (const line of tLines) {
      y += T_SIZE
      els.push(`<text x="${cx}" y="${y}" font-family="${FONT}" font-size="${T_SIZE}" font-weight="700" fill="#000000" text-anchor="middle">${escapeXml(line)}</text>`)
      y += T_LH - T_SIZE
    }
    if (sLines.length) y += GAP_AFTER_T
    for (const line of sLines) {
      y += S_SIZE
      els.push(`<text x="${cx}" y="${y}" font-family="${FONT}" font-size="${S_SIZE}" fill="#000000" text-anchor="middle">${escapeXml(line)}</text>`)
      y += S_LH - S_SIZE
    }
    const H = Math.round(y + PAD_BOT)

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${els.join('')}</svg>`
    const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 6 }).toBuffer()

    return new NextResponse(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
    })
  } catch (error) {
    console.error('[Podcast Promo Text] Error:', error)
    return new NextResponse('Image generation failed', { status: 500 })
  }
}
