import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

export const runtime = 'nodejs'

/**
 * GET /api/newsletter/thumbnail-image
 * Composites a transparent dithered thumbnail PNG onto a solid vote-color background.
 * Used exclusively for newsletter emails to prevent dark-mode clients from
 * inverting or overriding the CSS background-color fallback.
 *
 * Query params:
 * - url: The Vercel Blob URL of the transparent thumbnail PNG
 * - bg:  Background hex color without # (e.g. "00FF00")
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const imageUrl = searchParams.get('url')
    const bgHex = searchParams.get('bg') || '00FFFF'

    if (!imageUrl) {
      return new NextResponse('url param required', { status: 400 })
    }

    // Only allow known safe hosts
    const allowedHosts = [
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      'https://pub-',        // Vercel Blob URLs start with pub-
      'blob.vercel-storage', // Vercel Blob domain
    ].filter(Boolean)

    const urlObj = new URL(imageUrl)
    const isAllowed =
      allowedHosts.some(h => imageUrl.startsWith(h!)) ||
      urlObj.hostname.endsWith('vercel-storage.com') ||
      urlObj.hostname.endsWith('supabase.co')

    if (!isAllowed) {
      return new NextResponse('URL not allowed', { status: 403 })
    }

    // Fetch the transparent thumbnail
    const res = await fetch(imageUrl)
    if (!res.ok) {
      return new NextResponse('Failed to fetch image', { status: 502 })
    }

    const imageBuffer = Buffer.from(await res.arrayBuffer())
    const meta = await sharp(imageBuffer).metadata()
    const size = meta.width || 604

    // Parse background hex → RGB
    const hex = bgHex.replace('#', '').padEnd(6, '0')
    const bgR = parseInt(hex.slice(0, 2), 16)
    const bgG = parseInt(hex.slice(2, 4), 16)
    const bgB = parseInt(hex.slice(4, 6), 16)

    // Build solid-color background
    const bgBuffer = await sharp({
      create: { width: size, height: size, channels: 3, background: { r: bgR, g: bgG, b: bgB } },
    })
      .png()
      .toBuffer()

    // Composite transparent PNG over background → opaque PNG
    const result = await sharp(bgBuffer)
      .composite([{ input: imageBuffer, blend: 'over' }])
      .png()
      .toBuffer()

    return new NextResponse(new Uint8Array(result), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400', // 24h cache
      },
    })
  } catch (error) {
    console.error('[Newsletter Thumbnail] Error:', error)
    return new NextResponse('Image processing failed', { status: 500 })
  }
}
