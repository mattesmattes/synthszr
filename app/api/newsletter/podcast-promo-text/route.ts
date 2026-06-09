import { NextRequest } from 'next/server'
import { ImageResponse } from 'next/og'
import React from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const runtime = 'nodejs'

/**
 * GET /api/newsletter/podcast-promo-text?headline=…&title=…&subtitle=…
 *
 * Renders the podcast tip-promo TEXT (headline + episode title + subtitle) as a
 * transparent PNG with black text, at 2× for Retina. The newsletter overlays it
 * on the gradient box.
 *
 * Why an image: Gmail iOS dark mode inverts CSS text colors (black → white) but
 * NOT image pixels or the gradient background-image, so black HTML text turned
 * white and vanished on the light green box. Image pixels are immune — the text
 * stays black-on-green in every client/mode (same trick as the buttons).
 *
 * Uses next/og (Satori) rather than sharp+SVG: Satori embeds its own font, so it
 * renders real glyphs on Vercel where librsvg has no system font (it produced
 * empty tofu boxes).
 */

const W = 1040 // 2× of the ~520px content width

// Bundled Liberation Sans (Helvetica-compatible) so bold renders — next/og's
// default Geist only ships Regular, leaving the title un-bold. The new URL(...,
// import.meta.url) reference makes Next trace these .ttf into the function
// bundle; readFileSync (not fetch) because this is the Node runtime, where fetch
// can't read file:// URLs.
let fontCache: { regular: Buffer; bold: Buffer } | null = null
function loadFonts() {
  if (fontCache) return fontCache
  const regular = readFileSync(fileURLToPath(new URL('./font-regular.ttf', import.meta.url)))
  const bold = readFileSync(fileURLToPath(new URL('./font-bold.ttf', import.meta.url)))
  fontCache = { regular, bold }
  return fontCache
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const headline = (sp.get('headline') || '').toUpperCase()
  const title = sp.get('title') || ''
  const subtitle = sp.get('subtitle') || ''

  // Estimate height: Satori wraps flex text automatically, but ImageResponse
  // needs a fixed canvas. Approximate line counts from char width per font size.
  const titleLines = title ? Math.max(1, Math.ceil(title.length / 26)) : 0
  const subLines = subtitle ? Math.max(1, Math.ceil(subtitle.length / 37)) : 0
  const PAD_Y = 30
  const height =
    PAD_Y +
    36 + // headline line
    (titleLines ? 14 + titleLines * 54 : 0) +
    (subLines ? 8 + subLines * 46 : 0) +
    PAD_Y

  const children: React.ReactElement[] = [
    React.createElement(
      'div',
      {
        key: 'h',
        style: {
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: 3,
          color: '#000000',
          textTransform: 'uppercase',
          textAlign: 'center',
        },
      },
      headline
    ),
  ]
  if (title) {
    children.push(
      React.createElement(
        'div',
        {
          key: 't',
          style: { fontSize: 42, fontWeight: 700, color: '#000000', textAlign: 'center', marginTop: 14, lineHeight: 1.25 },
        },
        title
      )
    )
  }
  if (subtitle) {
    children.push(
      React.createElement(
        'div',
        {
          key: 's',
          style: { fontSize: 34, fontWeight: 400, color: '#000000', textAlign: 'center', marginTop: 8, lineHeight: 1.3 },
        },
        subtitle
      )
    )
  }

  const tree = React.createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `${PAD_Y}px 48px`,
        background: 'transparent',
        fontFamily: 'LibSans',
      },
    },
    children
  )

  const { regular, bold } = loadFonts()
  return new ImageResponse(tree, {
    width: W,
    height,
    fonts: [
      { name: 'LibSans', data: regular, weight: 400, style: 'normal' },
      { name: 'LibSans', data: bold, weight: 700, style: 'normal' },
    ],
  })
}
