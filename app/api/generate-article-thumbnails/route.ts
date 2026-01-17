import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import sharp from 'sharp'
import { createClient } from '@/lib/supabase/server'
import { generateSatiricalImage, applyDithering, whiteToTransparent } from '@/lib/gemini/image-generator'
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

// Thumbnail size - 604px for Retina displays (302px @ 2x)
// Fixed size prevents moiré from CSS scaling of dithered images
const THUMBNAIL_SIZE = 604

interface ArticleThumbnailRequest {
  postId: string
  articles: Array<{
    index: number
    text: string
    vote?: 'BUY' | 'HOLD' | 'SELL' | null
  }>
}

/**
 * Crop image to square and resize to thumbnail size
 * Returns base64 for further processing (dithering, transparency)
 */
async function cropAndResizeToSquare(imageBase64: string): Promise<string> {
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

  // Crop to square, resize, and boost contrast for stronger dithering
  const resizedBuffer = await sharp(imageBuffer)
    .extract({ left, top, width: cropSize, height: cropSize })
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .linear(1.4, -(255 * 0.2)) // Increase contrast by 40%
    .png()
    .toBuffer()

  return resizedBuffer.toString('base64')
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
        // Step 1: Generate raw image (no dithering yet)
        const result = await generateSatiricalImage(thumbnailText)

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

        // Step 2: Crop to square and resize to thumbnail size FIRST
        const squareBase64 = await cropAndResizeToSquare(result.imageBase64)

        // Step 3: Apply dithering with boosted gain for extra strong contrast
        const dithered = await applyDithering(squareBase64, 1.3, 1)

        // Step 4: Convert white to transparent
        const processed = await whiteToTransparent(dithered.base64)

        // Convert to buffer for upload
        const squareThumbnail = Buffer.from(processed.base64, 'base64')

        // Upload to Vercel Blob
        const fileName = `post-images/${postId}/thumbnail-${article.index}-${imageRecord.id}.png`

        try {
          const blob = await put(fileName, squareThumbnail, {
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

/**
 * DELETE /api/generate-article-thumbnails
 * Delete article thumbnails for a post (admin only)
 * Optional: articleIndex param to delete only a single thumbnail
 */
export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const postId = searchParams.get('postId')
  const articleIndex = searchParams.get('articleIndex')

  if (!postId) {
    return NextResponse.json({ error: 'postId is required' }, { status: 400 })
  }

  const supabase = await createClient()

  // Build query - optionally filter by article_index for single deletion
  let query = supabase
    .from('post_images')
    .delete()
    .eq('post_id', postId)
    .eq('image_type', 'article_thumbnail')

  if (articleIndex !== null) {
    query = query.eq('article_index', parseInt(articleIndex, 10))
  }

  const { error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, deleted: count })
}
