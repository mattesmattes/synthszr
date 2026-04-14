import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 30

// Pre-renders an ad-promo image with its BG color baked in via multiply blend.
// Email clients don't support CSS mix-blend-mode, so the newsletter template
// uses these flattened PNGs instead of the raw image + CSS blend.
//
// URL: /api/ad-promos/composite?id={promoId}&slot=left|right&v={updated_at_ms}
// The `v` param busts the CDN cache when admins change image or BG color.

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim()
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean
  const num = parseInt(full, 16)
  if (Number.isNaN(num)) return { r: 255, g: 255, b: 255 }
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const slot = searchParams.get('slot') === 'right' ? 'right' : 'left'

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: promo } = await supabase
    .from('ad_promos')
    .select('image_left_url, image_left_bg, image_right_url, image_right_bg')
    .eq('id', id)
    .maybeSingle()

  if (!promo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const imageUrl = slot === 'right' ? promo.image_right_url : promo.image_left_url
  const bg = slot === 'right' ? promo.image_right_bg : promo.image_left_bg

  if (!imageUrl) return NextResponse.json({ error: 'No image' }, { status: 404 })

  try {
    // Skip compositing for animated formats — multiply-flattening would strip
    // the animation. Redirect to the original so the email shows the live GIF
    // (without baked-in BG, but with movement preserved).
    const isAnimated = /\.gif(\?|$)/i.test(imageUrl)
    if (isAnimated) {
      return NextResponse.redirect(imageUrl, 302)
    }

    const res = await fetch(imageUrl)
    if (!res.ok) throw new Error(`Source fetch failed: ${res.status}`)
    const srcBuffer = Buffer.from(await res.arrayBuffer())

    const meta = await sharp(srcBuffer).metadata()
    const width = meta.width ?? 600
    const height = meta.height ?? 600
    const { r, g, b } = hexToRgb(bg || '#ffffff')

    // Flatten foreground onto BG using multiply (mirrors CSS mix-blend-mode: multiply).
    // Pre-multiply the image RGB against the BG so transparent pixels become BG.
    const composited = await sharp({
      create: { width, height, channels: 3, background: { r, g, b } },
    })
      .composite([{ input: srcBuffer, blend: 'multiply' }])
      .png({ compressionLevel: 9 })
      .toBuffer()

    return new NextResponse(new Uint8Array(composited), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        // Aggressive cache: URL is versioned via `?v=updated_at` so cache busts on edit
        'Cache-Control': 'public, max-age=31536000, immutable, s-maxage=31536000',
      },
    })
  } catch (err) {
    console.error('[ad-promo composite] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Composite failed' },
      { status: 500 },
    )
  }
}
