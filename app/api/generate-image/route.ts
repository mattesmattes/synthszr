import { verifyBearerToken } from '@/lib/security/cron-auth'
import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { createClient } from '@/lib/supabase/server'
import { generateAndProcessImage, generateEmailCover, generateDesktopCover, generateSatiricalImage, ImageProcessingOptions, CoverImageNews } from '@/lib/gemini/image-generator'
import { getSession } from '@/lib/auth/session'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

export const maxDuration = 300 // Allow up to 5 minutes for batch image generation

interface GenerateImageRequest {
  postId: string
  dailyRepoId?: string
  newsText: string
  enableDithering?: boolean
  ditheringGain?: number
}

export async function POST(request: NextRequest) {
  // Allow authentication via session OR cron secret (for scheduled tasks on Vercel)
  const session = await getSession()
  const authHeader = request.headers.get('authorization')
  const cronSecretValid = verifyBearerToken(authHeader, process.env.CRON_SECRET)

  if (!session && !cronSecretValid) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  // Rate limiting: 5 requests per minute for expensive image generation
  const rateLimitResult = await checkRateLimit(
    `generate-image:${getClientIP(request)}`,
    rateLimiters.strict() ?? undefined
  )
  if (!rateLimitResult.success) {
    return rateLimitResponse(rateLimitResult)
  }

  try {
    const body: GenerateImageRequest = await request.json()
    const { postId, dailyRepoId, newsText, enableDithering, ditheringGain } = body

    if (!postId || !newsText) {
      return NextResponse.json(
        { error: 'postId and newsText are required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Create pending image record
    const { data: imageRecord, error: insertError } = await supabase
      .from('post_images')
      .insert({
        post_id: postId,
        daily_repo_id: dailyRepoId || null,
        image_url: '', // Will be updated after generation
        source_text: newsText.slice(0, 5000),
        generation_status: 'generating',
      })
      .select()
      .single()

    if (insertError) {
      console.error('Failed to create image record:', insertError)
      return NextResponse.json(
        { error: 'Failed to create image record' },
        { status: 500 }
      )
    }

    // Step 1: Generate raw image. fast=true switches OpenAI gpt-image-2
    // to quality:'low' — output is dithered + color-quantized in later
    // steps, so quality difference is invisible and we save ~3× time.
    const rawResult = await generateSatiricalImage(newsText, { fast: true })
    if (!rawResult.success || !rawResult.imageBase64) {
      await supabase
        .from('post_images')
        .update({
          generation_status: 'failed',
          error_message: rawResult.error || 'Unknown error',
        })
        .eq('id', imageRecord.id)

      return NextResponse.json(
        { error: rawResult.error || 'Image generation failed' },
        { status: 500 }
      )
    }

    // Step 2: Process web version (resize to 1408px → dither → pad to square → transparent)
    const processingOptions: ImageProcessingOptions = {
      ...(enableDithering !== undefined ? { enableDithering } : {}),
      ...(ditheringGain !== undefined ? { ditheringGain } : {}),
      targetWidth: 1408,
    }
    const result = await generateAndProcessImage(newsText, processingOptions, rawResult.imageBase64)

    if (!result.success || !result.imageBase64) {
      await supabase
        .from('post_images')
        .update({
          generation_status: 'failed',
          error_message: result.error || 'Processing failed',
        })
        .eq('id', imageRecord.id)

      return NextResponse.json(
        { error: result.error || 'Image processing failed' },
        { status: 500 }
      )
    }

    const imageBuffer = Buffer.from(result.imageBase64, 'base64')

    // Upload web version to Vercel Blob
    const fileName = `post-images/${postId}/${imageRecord.id}.png`

    let blobUrl: string
    try {
      const blob = await put(fileName, imageBuffer, {
        access: 'public',
        contentType: result.mimeType || 'image/png',
      })
      blobUrl = blob.url
    } catch (uploadError) {
      console.error('Failed to upload image:', uploadError)
      await supabase
        .from('post_images')
        .update({
          generation_status: 'failed',
          error_message: 'Failed to upload image to storage',
        })
        .eq('id', imageRecord.id)

      return NextResponse.json(
        { error: 'Failed to upload image' },
        { status: 500 }
      )
    }

    // Upload raw (pre-dithered) image for later email cover regeneration
    let rawBlobUrl: string | null = null
    try {
      const rawFileName = `post-images/${postId}/${imageRecord.id}-raw.png`
      const rawBuffer = Buffer.from(rawResult.imageBase64, 'base64')
      const rawBlob = await put(rawFileName, rawBuffer, {
        access: 'public',
        contentType: 'image/png',
      })
      rawBlobUrl = rawBlob.url
    } catch (rawUploadError) {
      console.error('Failed to upload raw image (non-fatal):', rawUploadError)
    }

    // Update record with success
    const { data: updatedImage, error: updateError } = await supabase
      .from('post_images')
      .update({
        image_url: blobUrl,
        generation_status: 'completed',
        ...(rawBlobUrl ? { raw_image_url: rawBlobUrl } : {}),
      })
      .eq('id', imageRecord.id)
      .select()
      .single()

    if (updateError) {
      console.error('Failed to update image record:', updateError)
    }

    // Set as cover image and update post reference
    await supabase
      .from('post_images')
      .update({ is_cover: true })
      .eq('id', imageRecord.id)

    await supabase
      .from('generated_posts')
      .update({ cover_image_id: imageRecord.id })
      .eq('id', postId)

    // Step 3: Generate email cover version (non-fatal)
    try {
      const emailCover = await generateEmailCover(rawResult.imageBase64)

      const { data: emailRecord, error: emailInsertError } = await supabase
        .from('post_images')
        .insert({
          post_id: postId,
          daily_repo_id: dailyRepoId || null,
          image_url: '',
          source_text: newsText.slice(0, 5000),
          generation_status: 'generating',
          image_type: 'cover_email',
        })
        .select()
        .single()

      if (!emailInsertError && emailRecord) {
        const emailFileName = `post-images/${postId}/${emailRecord.id}-cover-email.png`
        const emailBuffer = Buffer.from(emailCover.base64, 'base64')

        const emailBlob = await put(emailFileName, emailBuffer, {
          access: 'public',
          contentType: 'image/png',
        })

        await supabase
          .from('post_images')
          .update({
            image_url: emailBlob.url,
            generation_status: 'completed',
          })
          .eq('id', emailRecord.id)

        console.log(`[Gemini] Email cover generated successfully for postId=${postId}`)
      }
    } catch (emailError) {
      console.error('[Gemini] Email cover generation failed (non-fatal):', emailError)
    }

    // Step 4: Generate desktop cover version (non-fatal)
    try {
      const desktopCover = await generateDesktopCover(rawResult.imageBase64)
      const { data: desktopRecord } = await supabase
        .from('post_images')
        .insert({
          post_id: postId,
          daily_repo_id: dailyRepoId || null,
          image_url: '',
          source_text: newsText.slice(0, 5000),
          generation_status: 'generating',
          image_type: 'cover_desktop',
        })
        .select()
        .single()

      if (desktopRecord) {
        const desktopBlob = await put(
          `post-images/${postId}/${desktopRecord.id}-cover-desktop.png`,
          Buffer.from(desktopCover.base64, 'base64'),
          { access: 'public', contentType: 'image/png' }
        )
        await supabase
          .from('post_images')
          .update({ image_url: desktopBlob.url, generation_status: 'completed' })
          .eq('id', desktopRecord.id)
        console.log(`[Gemini] Desktop cover generated successfully for postId=${postId}`)
      }
    } catch (desktopError) {
      console.error('[Gemini] Desktop cover generation failed (non-fatal):', desktopError)
    }

    return NextResponse.json({
      success: true,
      image: updatedImage,
    })
  } catch (error) {
    console.error('Generate image error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// Batch generate images for multiple news items - generates sequentially to avoid overload
export async function PUT(request: NextRequest) {
  // Allow authentication via session OR cron secret (for scheduled tasks on Vercel)
  const session = await getSession()
  const authHeader = request.headers.get('authorization')
  const cronSecretValid = verifyBearerToken(authHeader, process.env.CRON_SECRET)

  if (!session && !cronSecretValid) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  // Rate limiting: stricter for batch operations (3 per minute)
  const rateLimitResult = await checkRateLimit(
    `generate-image-batch:${getClientIP(request)}`,
    rateLimiters.strict() ?? undefined
  )
  if (!rateLimitResult.success) {
    return rateLimitResponse(rateLimitResult)
  }

  try {
    const body: {
      postId: string
      newsItems: Array<{ dailyRepoId?: string; text: string }>
      enableDithering?: boolean
      ditheringGain?: number
      coverMode?: boolean // When true, combines first 3 news items into one cover image
    } = await request.json()
    const { postId, newsItems, enableDithering, ditheringGain, coverMode } = body

    if (!postId || !newsItems || newsItems.length === 0) {
      return NextResponse.json(
        { error: 'postId and newsItems are required' },
        { status: 400 }
      )
    }

    // If no explicit dithering settings provided, let generator use DB settings
    // Always include targetWidth so covers are dithered at exact width, then padded to square
    const processingOptions: ImageProcessingOptions = {
      ...(enableDithering !== undefined ? { enableDithering } : {}),
      ...(ditheringGain !== undefined ? { ditheringGain } : {}),
      targetWidth: 1408,
    }

    const supabase = await createClient()
    const results: Array<{ success: boolean; error?: string; imageId?: string; model?: string }> = []

    // Cover mode: Generate ONE combined image from up to 3 news items
    if (coverMode && newsItems.length > 0) {
      console.log(`[Gemini] Generating cover image from ${Math.min(newsItems.length, 3)} news items for postId=${postId}`)

      // Build CoverImageNews from first 3 items
      const coverNews: CoverImageNews = {
        news1: newsItems[0]?.text || '',
        news2: newsItems[1]?.text,
        news3: newsItems[2]?.text,
      }

      const sourceText = [coverNews.news1, coverNews.news2, coverNews.news3]
        .filter(Boolean).join('\n---\n').slice(0, 5000)

      // Create pending image record for cover
      const { data: imageRecord, error: insertError } = await supabase
        .from('post_images')
        .insert({
          post_id: postId,
          daily_repo_id: null, // Cover combines multiple sources
          image_url: '',
          source_text: sourceText,
          generation_status: 'generating',
          is_cover: true,
        })
        .select()
        .single()

      if (insertError || !imageRecord) {
        console.error('Failed to create cover image record:', insertError)
        return NextResponse.json(
          { error: 'Failed to create cover image record' },
          { status: 500 }
        )
      }

      // Step 1: Generate raw image (once — used for web + email + desktop).
      // fast=true → OpenAI quality:'low'; invisible after dithering.
      const rawResult = await generateSatiricalImage(coverNews, { fast: true })

      if (!rawResult.success || !rawResult.imageBase64) {
        await supabase
          .from('post_images')
          .update({
            generation_status: 'failed',
            error_message: rawResult.error || 'Unknown error',
          })
          .eq('id', imageRecord.id)

        return NextResponse.json({
          success: false,
          error: rawResult.error || 'Cover image generation failed',
          results: [{ success: false, error: rawResult.error, imageId: imageRecord.id }]
        })
      }

      // Step 2: Process web version (scale → resize to 1408px → dither → transparent)
      const webOptions: ImageProcessingOptions = { ...processingOptions, targetWidth: 1408 }
      const result = await generateAndProcessImage(coverNews, webOptions, rawResult.imageBase64)

      if (!result.success || !result.imageBase64) {
        await supabase
          .from('post_images')
          .update({
            generation_status: 'failed',
            error_message: result.error || 'Processing failed',
          })
          .eq('id', imageRecord.id)

        return NextResponse.json({
          success: false,
          error: result.error || 'Cover image processing failed',
          results: [{ success: false, error: result.error, imageId: imageRecord.id }]
        })
      }

      // Upload raw (pre-dithered) image for later email cover regeneration
      let rawBlobUrlCover: string | null = null
      try {
        const rawFileName = `post-images/${postId}/${imageRecord.id}-raw.png`
        const rawBuffer = Buffer.from(rawResult.imageBase64!, 'base64')
        const rawBlob = await put(rawFileName, rawBuffer, {
          access: 'public',
          contentType: 'image/png',
        })
        rawBlobUrlCover = rawBlob.url
      } catch (rawUploadError) {
        console.error('Failed to upload raw cover image (non-fatal):', rawUploadError)
      }

      // Upload web version to Vercel Blob
      const fileName = `post-images/${postId}/${imageRecord.id}-cover.png`
      const imageBuffer = Buffer.from(result.imageBase64, 'base64')

      try {
        const blob = await put(fileName, imageBuffer, {
          access: 'public',
          contentType: result.mimeType || 'image/png',
        })

        await supabase
          .from('post_images')
          .update({
            image_url: blob.url,
            generation_status: 'completed',
            ...(rawBlobUrlCover ? { raw_image_url: rawBlobUrlCover } : {}),
          })
          .eq('id', imageRecord.id)

        // Set as cover in generated_posts
        await supabase
          .from('generated_posts')
          .update({ cover_image_id: imageRecord.id })
          .eq('id', postId)

        console.log(`[Gemini] Web cover generated successfully for postId=${postId}`)
      } catch (uploadError) {
        console.error('Failed to upload cover image:', uploadError)
        await supabase
          .from('post_images')
          .update({
            generation_status: 'failed',
            error_message: 'Failed to upload to storage',
          })
          .eq('id', imageRecord.id)

        return NextResponse.json({
          success: false,
          error: 'Failed to upload cover image',
          results: [{ success: false, error: 'Upload failed', imageId: imageRecord.id }]
        })
      }

      // Step 3: Generate email version (natively dithered at 604px)
      const coverResults: Array<{ success: boolean; error?: string; imageId?: string }> = [
        { success: true, imageId: imageRecord.id }
      ]

      try {
        const emailCover = await generateEmailCover(rawResult.imageBase64!)

        // Create email cover record
        const { data: emailRecord, error: emailInsertError } = await supabase
          .from('post_images')
          .insert({
            post_id: postId,
            daily_repo_id: null,
            image_url: '',
            source_text: sourceText,
            generation_status: 'generating',
            image_type: 'cover_email',
          })
          .select()
          .single()

        if (emailInsertError || !emailRecord) {
          console.error('Failed to create email cover record:', emailInsertError)
        } else {
          const emailFileName = `post-images/${postId}/${emailRecord.id}-cover-email.png`
          const emailBuffer = Buffer.from(emailCover.base64, 'base64')

          const emailBlob = await put(emailFileName, emailBuffer, {
            access: 'public',
            contentType: 'image/png',
          })

          await supabase
            .from('post_images')
            .update({
              image_url: emailBlob.url,
              generation_status: 'completed',
            })
            .eq('id', emailRecord.id)

          console.log(`[Gemini] Email cover generated successfully for postId=${postId}`)
          coverResults.push({ success: true, imageId: emailRecord.id })
        }
      } catch (emailError) {
        console.error('[Gemini] Email cover generation failed (non-fatal):', emailError)
        // Non-fatal: web cover is already saved, email will fall back to runtime API
      }

      // Step 4: Generate desktop cover version (non-fatal)
      try {
        const desktopCover = await generateDesktopCover(rawResult.imageBase64!)
        const { data: desktopRecord } = await supabase
          .from('post_images')
          .insert({
            post_id: postId,
            daily_repo_id: null,
            image_url: '',
            source_text: sourceText,
            generation_status: 'generating',
            image_type: 'cover_desktop',
          })
          .select()
          .single()

        if (desktopRecord) {
          const desktopBlob = await put(
            `post-images/${postId}/${desktopRecord.id}-cover-desktop.png`,
            Buffer.from(desktopCover.base64, 'base64'),
            { access: 'public', contentType: 'image/png' }
          )
          await supabase
            .from('post_images')
            .update({ image_url: desktopBlob.url, generation_status: 'completed' })
            .eq('id', desktopRecord.id)
          console.log(`[Gemini] Desktop cover generated for postId=${postId}`)
          coverResults.push({ success: true, imageId: desktopRecord.id })
        }
      } catch (desktopError) {
        console.error('[Gemini] Desktop cover generation failed (non-fatal):', desktopError)
      }

      return NextResponse.json({
        success: true,
        results: coverResults,
      })
    }

    // Standard mode: Process images sequentially (one per news item)
    let coverSetInBatch = false
    for (const item of newsItems) {
      try {
        console.log(`[Gemini] Starting image generation for postId=${postId}`)

        // Create pending image record
        const { data: imageRecord, error: insertError } = await supabase
          .from('post_images')
          .insert({
            post_id: postId,
            daily_repo_id: item.dailyRepoId || null,
            image_url: '',
            source_text: item.text.slice(0, 5000),
            generation_status: 'generating',
          })
          .select()
          .single()

        if (insertError || !imageRecord) {
          console.error('Failed to create image record:', insertError)
          results.push({ success: false, error: 'Failed to create record' })
          continue
        }

        // Step 1: Generate raw image. fast=true → OpenAI quality:'low'.
        const rawResult = await generateSatiricalImage(item.text, { fast: true })
        if (!rawResult.success || !rawResult.imageBase64) {
          await supabase
            .from('post_images')
            .update({
              generation_status: 'failed',
              error_message: rawResult.error || 'Unknown error',
            })
            .eq('id', imageRecord.id)

          results.push({ success: false, error: rawResult.error, imageId: imageRecord.id })
          continue
        }

        // Step 2: Process web version
        const result = await generateAndProcessImage(item.text, processingOptions, rawResult.imageBase64)

        if (!result.success || !result.imageBase64) {
          await supabase
            .from('post_images')
            .update({
              generation_status: 'failed',
              error_message: result.error || 'Processing failed',
            })
            .eq('id', imageRecord.id)

          results.push({ success: false, error: result.error, imageId: imageRecord.id })
          continue
        }

        // Upload raw (pre-dithered) image for later email cover regeneration
        let rawBlobUrlBatch: string | null = null
        try {
          const rawFileName = `post-images/${postId}/${imageRecord.id}-raw.png`
          const rawBuffer = Buffer.from(rawResult.imageBase64, 'base64')
          const rawBlob = await put(rawFileName, rawBuffer, {
            access: 'public',
            contentType: 'image/png',
          })
          rawBlobUrlBatch = rawBlob.url
        } catch (rawUploadError) {
          console.error('Failed to upload raw image (non-fatal):', rawUploadError)
        }

        // Upload to Vercel Blob
        const fileName = `post-images/${postId}/${imageRecord.id}.png`
        const imageBuffer = Buffer.from(result.imageBase64, 'base64')

        try {
          const blob = await put(fileName, imageBuffer, {
            access: 'public',
            contentType: result.mimeType || 'image/png',
          })

          await supabase
            .from('post_images')
            .update({
              image_url: blob.url,
              generation_status: 'completed',
              ...(rawBlobUrlBatch ? { raw_image_url: rawBlobUrlBatch } : {}),
            })
            .eq('id', imageRecord.id)

          // Set first image in batch as cover + generate email version
          if (!coverSetInBatch) {
            coverSetInBatch = true

            await supabase
              .from('post_images')
              .update({ is_cover: true })
              .eq('id', imageRecord.id)

            await supabase
              .from('generated_posts')
              .update({ cover_image_id: imageRecord.id })
              .eq('id', postId)

            // Generate email cover version (non-fatal)
            try {
              const emailCover = await generateEmailCover(rawResult.imageBase64)
              const { data: emailRecord } = await supabase
                .from('post_images')
                .insert({
                  post_id: postId,
                  daily_repo_id: item.dailyRepoId || null,
                  image_url: '',
                  source_text: item.text.slice(0, 5000),
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
                console.log(`[Gemini] Email cover generated for postId=${postId}`)
              }
            } catch (emailErr) {
              console.error('[Gemini] Email cover failed (non-fatal):', emailErr)
            }

            // Generate desktop cover version (non-fatal)
            try {
              const desktopCover = await generateDesktopCover(rawResult.imageBase64)
              const { data: desktopRecord } = await supabase
                .from('post_images')
                .insert({
                  post_id: postId,
                  daily_repo_id: item.dailyRepoId || null,
                  image_url: '',
                  source_text: item.text.slice(0, 5000),
                  generation_status: 'generating',
                  image_type: 'cover_desktop',
                })
                .select()
                .single()

              if (desktopRecord) {
                const desktopBlob = await put(
                  `post-images/${postId}/${desktopRecord.id}-cover-desktop.png`,
                  Buffer.from(desktopCover.base64, 'base64'),
                  { access: 'public', contentType: 'image/png' }
                )
                await supabase
                  .from('post_images')
                  .update({ image_url: desktopBlob.url, generation_status: 'completed' })
                  .eq('id', desktopRecord.id)
                console.log(`[Gemini] Desktop cover generated for postId=${postId}`)
              }
            } catch (desktopErr) {
              console.error('[Gemini] Desktop cover failed (non-fatal):', desktopErr)
            }
          }

          results.push({ success: true, imageId: imageRecord.id, model: rawResult.model })
          console.log(`[Gemini] Image generated successfully for postId=${postId} via ${rawResult.model}`)
        } catch (uploadError) {
          console.error('Failed to upload image:', uploadError)
          await supabase
            .from('post_images')
            .update({
              generation_status: 'failed',
              error_message: 'Failed to upload to storage',
            })
            .eq('id', imageRecord.id)

          results.push({ success: false, error: 'Upload failed', imageId: imageRecord.id })
        }
      } catch (itemError) {
        console.error('Item generation error:', itemError)
        results.push({
          success: false,
          error: itemError instanceof Error ? itemError.message : 'Unknown error'
        })
      }

      // Small delay between generations to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    return NextResponse.json({
      success: results.some(r => r.success),
      results,
    })
  } catch (error) {
    console.error('Batch generate error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
