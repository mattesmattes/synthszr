import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import sharp from 'sharp'
import { createClient } from '@/lib/supabase/server'
import { generateAndProcessImage } from '@/lib/gemini/image-generator'
import { getSession } from '@/lib/auth/session'

export const maxDuration = 300 // Allow up to 5 minutes for batch thumbnail generation

// Vote-based background colors
const VOTE_COLORS = {
  NONE: '#CCFF00',   // Neon Yellow - no vote
  BUY: '#39FF14',    // Neon Green
  HOLD: '#00FFFF',   // Neon Cyan
  SELL: '#FF6600',   // Neon Orange
} as const

type VoteType = keyof typeof VOTE_COLORS

// Thumbnail size
const THUMBNAIL_SIZE = 302

interface ArticleThumbnailRequest {
  postId: string
  articles: Array<{
    index: number
    text: string
    vote?: 'BUY' | 'HOLD' | 'SELL' | null
  }>
}

/**
 * Process image into circular thumbnail with transparent background
 * The vote color is applied via CSS, not baked into the image
 */
async function processToCircularThumbnail(
  imageBase64: string
): Promise<Buffer> {
  const imageBuffer = Buffer.from(imageBase64, 'base64')

  // Get image metadata
  const metadata = await sharp(imageBuffer).metadata()
  const { width, height } = metadata

  if (!width || !height) {
    throw new Error('Invalid image dimensions')
  }

  // Calculate center crop for square
  const cropSize = Math.min(width, height)
  const left = Math.floor((width - cropSize) / 2)
  const top = Math.floor((height - cropSize) / 2)

  // Crop to square and resize
  const croppedBuffer = await sharp(imageBuffer)
    .extract({ left, top, width: cropSize, height: cropSize })
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { data, info } = croppedBuffer

  // Process pixels: white/transparent → transparent, dark → black
  // Same approach as cover images - artwork is black on transparent
  const pixels = new Uint8Array(data)
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]
    const a = pixels[i + 3]

    // Calculate luminance
    const luminance = (r + g + b) / 3

    // If pixel is transparent OR bright → make transparent
    // If pixel is dark → pure black (the artwork)
    const threshold = 128
    if (a < 128 || luminance >= threshold) {
      pixels[i] = 0
      pixels[i + 1] = 0
      pixels[i + 2] = 0
      pixels[i + 3] = 0  // Transparent
    } else {
      pixels[i] = 0
      pixels[i + 1] = 0
      pixels[i + 2] = 0
      pixels[i + 3] = 255  // Opaque black
    }
  }

  // Create circular mask
  const circleSize = THUMBNAIL_SIZE
  const circleSvg = Buffer.from(`
    <svg width="${circleSize}" height="${circleSize}">
      <circle cx="${circleSize / 2}" cy="${circleSize / 2}" r="${circleSize / 2}" fill="white"/>
    </svg>
  `)

  // Apply circular mask
  const finalImage = await sharp(Buffer.from(pixels), {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .composite([{
      input: circleSvg,
      blend: 'dest-in',
    }])
    .png()
    .toBuffer()

  return finalImage
}

/**
 * POST /api/generate-article-thumbnails
 * Generate circular thumbnails for articles in a post
 */
export async function POST(request: NextRequest) {
  // Require admin authentication
  const session = await getSession()
  const authHeader = request.headers.get('authorization')
  const cronSecretValid = authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!session && !cronSecretValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body: ArticleThumbnailRequest = await request.json()
    const { postId, articles } = body

    if (!postId || !articles || articles.length === 0) {
      return NextResponse.json(
        { error: 'postId and articles are required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const results: Array<{
      index: number
      success: boolean
      error?: string
      imageId?: string
      imageUrl?: string
    }> = []

    // Delete existing article thumbnails before regenerating
    const { error: deleteError } = await supabase
      .from('post_images')
      .delete()
      .eq('post_id', postId)
      .eq('image_type', 'article_thumbnail')

    if (deleteError) {
      console.error('[Thumbnail] Failed to delete existing thumbnails:', deleteError)
    } else {
      console.log(`[Thumbnail] Deleted existing article thumbnails for post ${postId}`)
    }

    // Process articles sequentially to avoid API rate limits
    for (const article of articles) {
      try {
        console.log(`[Thumbnail] Generating thumbnail ${article.index + 1}/${articles.length} for post ${postId}`)

        // Determine vote color
        const voteType: VoteType = article.vote || 'NONE'
        const voteColor = VOTE_COLORS[voteType]

        // Create pending image record
        const { data: imageRecord, error: insertError } = await supabase
          .from('post_images')
          .insert({
            post_id: postId,
            image_url: '',
            source_text: article.text.slice(0, 2000),
            generation_status: 'generating',
            article_index: article.index,
            vote_color: voteColor,
            image_type: 'article_thumbnail',
          })
          .select()
          .single()

        if (insertError || !imageRecord) {
          console.error('Failed to create thumbnail record:', insertError)
          results.push({ index: article.index, success: false, error: 'Failed to create record' })
          continue
        }

        // Generate the image (use shorter text for thumbnails)
        const thumbnailText = article.text.slice(0, 500)
        const result = await generateAndProcessImage(thumbnailText)

        if (!result.success || !result.imageBase64) {
          await supabase
            .from('post_images')
            .update({
              generation_status: 'failed',
              error_message: result.error || 'Image generation failed',
            })
            .eq('id', imageRecord.id)

          results.push({ index: article.index, success: false, error: result.error, imageId: imageRecord.id })
          continue
        }

        // Process into circular thumbnail (transparent background, color via CSS)
        const circularThumbnail = await processToCircularThumbnail(result.imageBase64)

        // Upload to Vercel Blob
        const fileName = `post-images/${postId}/thumbnail-${article.index}-${imageRecord.id}.png`

        try {
          const blob = await put(fileName, circularThumbnail, {
            access: 'public',
            contentType: 'image/png',
          })

          await supabase
            .from('post_images')
            .update({
              image_url: blob.url,
              generation_status: 'completed',
            })
            .eq('id', imageRecord.id)

          results.push({
            index: article.index,
            success: true,
            imageId: imageRecord.id,
            imageUrl: blob.url,
          })

          console.log(`[Thumbnail] Generated thumbnail ${article.index + 1}/${articles.length} successfully`)
        } catch (uploadError) {
          console.error('Failed to upload thumbnail:', uploadError)
          await supabase
            .from('post_images')
            .update({
              generation_status: 'failed',
              error_message: 'Failed to upload to storage',
            })
            .eq('id', imageRecord.id)

          results.push({ index: article.index, success: false, error: 'Upload failed', imageId: imageRecord.id })
        }
      } catch (itemError) {
        console.error('Thumbnail generation error:', itemError)
        results.push({
          index: article.index,
          success: false,
          error: itemError instanceof Error ? itemError.message : 'Unknown error',
        })
      }

      // Delay between generations to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1500))
    }

    return NextResponse.json({
      success: results.some(r => r.success),
      generated: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    })
  } catch (error) {
    console.error('Article thumbnails error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/generate-article-thumbnails
 * Get article thumbnails for a post (public endpoint - read only)
 */
export async function GET(request: NextRequest) {
  // Public endpoint - no auth required for reading thumbnails
  const { searchParams } = new URL(request.url)
  const postId = searchParams.get('postId')

  if (!postId) {
    return NextResponse.json({ error: 'postId is required' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: thumbnails, error } = await supabase
    .from('post_images')
    .select('*')
    .eq('post_id', postId)
    .eq('image_type', 'article_thumbnail')
    .order('article_index', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ thumbnails })
}
