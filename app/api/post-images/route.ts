import { NextRequest, NextResponse } from 'next/server'
import { del, put } from '@vercel/blob'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { generateAndProcessImage, generateEmailCover, generateSatiricalImage } from '@/lib/gemini/image-generator'

// Get images for a post
export async function GET(request: NextRequest) {
  // Require admin authentication
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const postId = searchParams.get('postId')

  if (!postId) {
    return NextResponse.json({ error: 'postId is required' }, { status: 400 })
  }

  const supabase = await createClient()

  // Only return cover images, not article thumbnails
  const { data: images, error } = await supabase
    .from('post_images')
    .select('*')
    .eq('post_id', postId)
    .or('image_type.is.null,image_type.eq.cover')
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ images })
}

// Set cover image
export async function PATCH(request: NextRequest) {
  // Require admin authentication
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const { postId, imageId } = await request.json()

    if (!postId || !imageId) {
      return NextResponse.json(
        { error: 'postId and imageId are required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Remove existing cover
    await supabase
      .from('post_images')
      .update({ is_cover: false })
      .eq('post_id', postId)

    // Set new cover
    const { error: updateError } = await supabase
      .from('post_images')
      .update({ is_cover: true })
      .eq('id', imageId)
      .eq('post_id', postId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Update generated_posts reference
    await supabase
      .from('generated_posts')
      .update({ cover_image_id: imageId })
      .eq('id', postId)

    // Delete old email cover DB records (but keep blobs — they may be referenced by already-sent newsletters)
    await supabase
      .from('post_images')
      .delete()
      .eq('post_id', postId)
      .eq('image_type', 'cover_email')

    // Regenerate email cover from raw image (if available)
    const { data: newCoverImage } = await supabase
      .from('post_images')
      .select('raw_image_url')
      .eq('id', imageId)
      .single()

    if (newCoverImage?.raw_image_url) {
      try {
        // Fetch raw image from blob storage
        const rawResponse = await fetch(newCoverImage.raw_image_url)
        const rawBuffer = Buffer.from(await rawResponse.arrayBuffer())
        const rawBase64 = rawBuffer.toString('base64')

        // Generate email cover (natively dithered at 604px)
        const emailCover = await generateEmailCover(rawBase64)

        // Create record + upload
        const { data: emailRecord } = await supabase
          .from('post_images')
          .insert({
            post_id: postId,
            image_url: '',
            generation_status: 'generating',
            image_type: 'cover_email',
          })
          .select()
          .single()

        if (emailRecord) {
          const emailBlob = await put(
            `post-images/${postId}/${emailRecord.id}-cover-email.png`,
            Buffer.from(emailCover.base64, 'base64'),
            { access: 'public', contentType: 'image/png' }
          )
          await supabase
            .from('post_images')
            .update({ image_url: emailBlob.url, generation_status: 'completed' })
            .eq('id', emailRecord.id)

          console.log(`[Cover Change] Email cover regenerated for postId=${postId}`)
        }
      } catch (emailError) {
        console.error('[Cover Change] Email cover regeneration failed (non-fatal):', emailError)
      }
    } else {
      console.warn(`[Cover Change] No raw_image_url for imageId=${imageId}, newsletter will use runtime API fallback`)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// Delete an image
export async function DELETE(request: NextRequest) {
  // Require admin authentication
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const imageId = searchParams.get('imageId')

  if (!imageId) {
    return NextResponse.json({ error: 'imageId is required' }, { status: 400 })
  }

  const supabase = await createClient()

  // Get image details first
  const { data: image } = await supabase
    .from('post_images')
    .select('*')
    .eq('id', imageId)
    .single()

  if (image) {
    // Delete from Vercel Blob if URL exists
    if (image.image_url) {
      try {
        await del(image.image_url)
      } catch (e) {
        console.error('Failed to delete blob:', e)
      }
    }

    // If this was the cover, clear the reference
    if (image.is_cover) {
      await supabase
        .from('generated_posts')
        .update({ cover_image_id: null })
        .eq('id', image.post_id)
    }
  }

  // Delete the record
  const { error } = await supabase
    .from('post_images')
    .delete()
    .eq('id', imageId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// Recreate/regenerate an image
export async function PUT(request: NextRequest) {
  // Require admin authentication
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const { imageId } = await request.json()

    if (!imageId) {
      return NextResponse.json({ error: 'imageId is required' }, { status: 400 })
    }

    const supabase = await createClient()

    // Get existing image record
    const { data: image, error: fetchError } = await supabase
      .from('post_images')
      .select('*')
      .eq('id', imageId)
      .single()

    if (fetchError || !image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }

    if (!image.source_text) {
      return NextResponse.json(
        { error: 'No source text available for regeneration' },
        { status: 400 }
      )
    }

    // Set status to generating
    await supabase
      .from('post_images')
      .update({
        generation_status: 'generating',
        error_message: null,
      })
      .eq('id', imageId)

    // Delete old blob if exists
    if (image.image_url) {
      try {
        await del(image.image_url)
      } catch (e) {
        console.error('Failed to delete old blob:', e)
      }
    }

    // Step 1: Generate raw image
    console.log(`[Recreate] Regenerating image ${imageId}...`)
    const rawResult = await generateSatiricalImage(image.source_text)

    if (!rawResult.success || !rawResult.imageBase64) {
      await supabase
        .from('post_images')
        .update({
          generation_status: 'failed',
          error_message: rawResult.error || 'Raw generation failed',
        })
        .eq('id', imageId)

      return NextResponse.json(
        { error: rawResult.error || 'Regeneration failed' },
        { status: 500 }
      )
    }

    // Step 2: Process web version (resize to 1408px → dither → pad to square)
    const result = await generateAndProcessImage(image.source_text, { targetWidth: 1408 }, rawResult.imageBase64)

    if (!result.success || !result.imageBase64) {
      await supabase
        .from('post_images')
        .update({
          generation_status: 'failed',
          error_message: result.error || 'Processing failed',
        })
        .eq('id', imageId)

      return NextResponse.json(
        { error: result.error || 'Regeneration failed' },
        { status: 500 }
      )
    }

    // Upload raw image for later email cover regeneration
    let rawBlobUrl: string | null = null
    try {
      const rawBlob = await put(
        `post-images/${image.post_id}/${imageId}-raw.png`,
        Buffer.from(rawResult.imageBase64, 'base64'),
        { access: 'public', contentType: 'image/png' }
      )
      rawBlobUrl = rawBlob.url
    } catch (rawErr) {
      console.error('Failed to upload raw image (non-fatal):', rawErr)
    }

    // Upload processed web version to Vercel Blob
    const fileName = `post-images/${image.post_id}/${imageId}-${Date.now()}.png`
    const imageBuffer = Buffer.from(result.imageBase64, 'base64')

    const blob = await put(fileName, imageBuffer, {
      access: 'public',
      contentType: result.mimeType || 'image/png',
    })

    // Update record
    const { data: updatedImage, error: updateError } = await supabase
      .from('post_images')
      .update({
        image_url: blob.url,
        generation_status: 'completed',
        error_message: null,
        ...(rawBlobUrl ? { raw_image_url: rawBlobUrl } : {}),
      })
      .eq('id', imageId)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // If this is a cover image, regenerate email cover too
    if (image.is_cover) {
      try {
        // Delete old email cover DB records (keep blobs — may be referenced by sent newsletters)
        await supabase
          .from('post_images')
          .delete()
          .eq('post_id', image.post_id)
          .eq('image_type', 'cover_email')

        // Generate new email cover from raw
        const emailCover = await generateEmailCover(rawResult.imageBase64)
        const { data: emailRecord } = await supabase
          .from('post_images')
          .insert({
            post_id: image.post_id,
            image_url: '',
            generation_status: 'generating',
            image_type: 'cover_email',
          })
          .select()
          .single()

        if (emailRecord) {
          const emailBlob = await put(
            `post-images/${image.post_id}/${emailRecord.id}-cover-email.png`,
            Buffer.from(emailCover.base64, 'base64'),
            { access: 'public', contentType: 'image/png' }
          )
          await supabase
            .from('post_images')
            .update({ image_url: emailBlob.url, generation_status: 'completed' })
            .eq('id', emailRecord.id)
          console.log(`[Recreate] Email cover regenerated for postId=${image.post_id}`)
        }
      } catch (emailErr) {
        console.error('[Recreate] Email cover regeneration failed (non-fatal):', emailErr)
      }
    }

    console.log(`[Recreate] Image ${imageId} regenerated successfully`)

    return NextResponse.json({ success: true, image: updatedImage })
  } catch (error) {
    console.error('Recreate image error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
