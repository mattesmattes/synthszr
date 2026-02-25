import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { readFileSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'
// Podigee publishing can take a while (cover generation + upload + API calls)
export const maxDuration = 60

const COVER_SIZE = 1400
const NEON_GREEN = { r: 0, g: 255, b: 0 }
const PODIGEE_BASE = 'https://app.podigee.com/api/v1'

function podigeeHeaders() {
  const apiKey = process.env.PODIGEE_API_KEY
  if (!apiKey) throw new Error('PODIGEE_API_KEY is not configured')
  return {
    'Token': apiKey,
    'Content-Type': 'application/json',
  }
}

async function podigeeRequest(
  path: string,
  method: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${PODIGEE_BASE}${path}`, {
    method,
    headers: podigeeHeaders(),
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

/**
 * POST /api/podcast/publish-podigee
 * Publishes a podcast episode to Podigee.
 *
 * Body: { postId: string, audioUrl: string, title: string, subtitle: string }
 * Returns: { episodeUrl: string, episodeId: number }
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const podcastId = process.env.PODIGEE_PODCAST_ID
  if (!podcastId) {
    return NextResponse.json({ error: 'PODIGEE_PODCAST_ID ist nicht konfiguriert' }, { status: 500 })
  }

  const body = await request.json()
  const { postId, audioUrl, title, subtitle, description } = body as {
    postId: string
    audioUrl: string
    title: string
    subtitle: string
    description?: string
  }

  if (!postId || !audioUrl || !title) {
    return NextResponse.json({ error: 'postId, audioUrl und title sind erforderlich' }, { status: 400 })
  }

  try {
    const supabase = createAdminClient()

    // ─── Step 1: Generate podcast cover PNG (1400×1400) ───────────────────────
    const { data: post } = await supabase
      .from('generated_posts')
      .select('id, title, post_images!cover_image_id(image_url)')
      .eq('id', postId)
      .single()

    if (!post) {
      return NextResponse.json({ error: 'Post nicht gefunden' }, { status: 404 })
    }

    const postImages = post.post_images as { image_url: string } | { image_url: string }[] | null
    const imageUrl = Array.isArray(postImages)
      ? postImages[0]?.image_url
      : postImages?.image_url

    if (!imageUrl) {
      return NextResponse.json({ error: 'Kein Cover-Bild für diesen Post' }, { status: 404 })
    }

    const imgResponse = await fetch(imageUrl)
    if (!imgResponse.ok) {
      return NextResponse.json({ error: 'Cover-Bild konnte nicht geladen werden' }, { status: 502 })
    }

    const imageBuffer = Buffer.from(await imgResponse.arrayBuffer())
    const metadata = await sharp(imageBuffer).metadata()
    const { width, height } = metadata

    if (!width || !height) {
      return NextResponse.json({ error: 'Ungültiges Bild' }, { status: 400 })
    }

    const cropSize = Math.min(width, height)
    const left = Math.floor((width - cropSize) / 2)
    const top = Math.floor((height - cropSize) / 2)

    const { data: pixelData, info } = await sharp(imageBuffer)
      .extract({ left, top, width: cropSize, height: cropSize })
      .resize(COVER_SIZE, COVER_SIZE, { fit: 'fill', kernel: sharp.kernel.nearest })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const pixels = new Uint8Array(pixelData)
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

    let coverPng = await sharp(Buffer.from(pixels), {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer()

    const logoSvgRaw = readFileSync(join(process.cwd(), 'public', 'synthszr-logo.svg'), 'utf-8')
    const logoWidth = Math.round(COVER_SIZE * 0.65)
    const logoHeight = Math.round(logoWidth / 4.475)
    const logoSvg = logoSvgRaw.replace(
      /<svg([^>]*)>/,
      `<svg$1 width="${logoWidth}" height="${logoHeight}">`
    )

    coverPng = await sharp(coverPng)
      .composite([
        {
          input: Buffer.from(logoSvg),
          top: Math.round((COVER_SIZE - logoHeight) / 2),
          left: Math.round((COVER_SIZE - logoWidth) / 2),
        },
      ])
      .png()
      .toBuffer()

    // ─── Step 2: Upload cover to Supabase Storage ─────────────────────────────
    const coverPath = `${postId}.png`
    const { error: uploadError } = await supabase.storage
      .from('podcast-covers')
      .upload(coverPath, coverPng, {
        contentType: 'image/png',
        upsert: true,
      })

    if (uploadError) {
      console.error('[Publish Podigee] Cover upload error:', uploadError)
      return NextResponse.json(
        { error: `Cover-Upload fehlgeschlagen: ${uploadError.message}` },
        { status: 500 }
      )
    }

    const { data: publicUrlData } = supabase.storage
      .from('podcast-covers')
      .getPublicUrl(coverPath)

    const coverPublicUrl = publicUrlData.publicUrl

    // ─── Step 3: Create episode ───────────────────────────────────────────────
    const episodeRes = await podigeeRequest('/episodes', 'POST', {
      podcast_id: parseInt(podcastId, 10),
      title,
      subtitle,
      summary: description || '',
    })

    if (!episodeRes.ok) {
      console.error('[Publish Podigee] Create episode error:', episodeRes.data)
      return NextResponse.json(
        { error: `Episode konnte nicht erstellt werden (${episodeRes.status})` },
        { status: 502 }
      )
    }

    const episode = episodeRes.data as { id: number; url?: string }
    const episodeId = episode.id

    // ─── Step 4: Request pre-signed upload URL for MP3 ───────────────────────
    const uploadRes = await podigeeRequest('/uploads?filename=podcast.mp3', 'POST')

    if (!uploadRes.ok) {
      console.error('[Publish Podigee] Create upload error:', uploadRes.data)
      return NextResponse.json(
        { error: `Upload-URL konnte nicht angefordert werden (${uploadRes.status})` },
        { status: 502 }
      )
    }

    const upload = uploadRes.data as { id: number; upload_url: string }
    const { upload_url: uploadUrl } = upload

    // ─── Step 5: Fetch MP3 and PUT to S3 ─────────────────────────────────────
    const mp3Response = await fetch(audioUrl)
    if (!mp3Response.ok) {
      return NextResponse.json(
        { error: 'MP3 konnte nicht heruntergeladen werden' },
        { status: 502 }
      )
    }

    const mp3Buffer = await mp3Response.arrayBuffer()

    // PUT to S3 pre-signed URL — no Authorization header here (S3 rejects unknown headers)
    const s3PutRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/mpeg' },
      body: mp3Buffer,
    })

    if (!s3PutRes.ok) {
      return NextResponse.json(
        { error: `MP3-Upload zu S3 fehlgeschlagen (${s3PutRes.status})` },
        { status: 502 }
      )
    }

    // Strip pre-signed query params to get the stable S3 object URL
    const parsedUploadUrl = new URL(uploadUrl)
    const fileUrl = `${parsedUploadUrl.origin}${parsedUploadUrl.pathname}`

    // ─── Step 6: Create production + auto-publish ─────────────────────────────
    // Podigee expects files array with the S3 URL (not upload_id)
    const productionRes = await podigeeRequest('/productions?publish_episode=true', 'POST', {
      episode_id: episodeId,
      files: [{ url: fileUrl }],
    })

    if (!productionRes.ok) {
      console.error('[Publish Podigee] Create production error:', productionRes.data)
      return NextResponse.json(
        { error: `Production konnte nicht erstellt werden (${productionRes.status})` },
        { status: 502 }
      )
    }

    // ─── Step 8: Set cover image ──────────────────────────────────────────────
    const patchRes = await podigeeRequest(`/episodes/${episodeId}`, 'PATCH', {
      cover_image: coverPublicUrl,
    })

    if (!patchRes.ok) {
      // Non-fatal: episode is already published, cover is optional
      console.warn('[Publish Podigee] Cover patch warning:', patchRes.data)
    }

    const episodeUrl = (episode.url as string | undefined) || `https://app.podigee.com/episodes/${episodeId}`

    console.log(`[Publish Podigee] Successfully published episode ${episodeId}: ${episodeUrl}`)

    return NextResponse.json({ episodeUrl, episodeId })
  } catch (error) {
    console.error('[Publish Podigee] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unbekannter Fehler' },
      { status: 500 }
    )
  }
}
