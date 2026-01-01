import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { createClient } from '@/lib/supabase/server'
import { generateAndProcessImage, ImageProcessingOptions } from '@/lib/gemini/image-generator'

export const maxDuration = 300 // Allow up to 5 minutes for batch image generation

interface GenerateImageRequest {
  postId: string
  dailyRepoId?: string
  newsText: string
  enableDithering?: boolean
  ditheringGain?: number
}

export async function POST(request: NextRequest) {
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

    // Generate the image with processing options
    const processingOptions: ImageProcessingOptions = {
      enableDithering: enableDithering ?? false,
      ditheringGain: ditheringGain ?? 1.0,
    }
    const result = await generateAndProcessImage(newsText, processingOptions)

    if (!result.success || !result.imageBase64) {
      // Update record with error
      await supabase
        .from('post_images')
        .update({
          generation_status: 'failed',
          error_message: result.error || 'Unknown error',
        })
        .eq('id', imageRecord.id)

      return NextResponse.json(
        { error: result.error || 'Image generation failed' },
        { status: 500 }
      )
    }

    // Upload to Vercel Blob
    const fileName = `post-images/${postId}/${imageRecord.id}.png`
    const imageBuffer = Buffer.from(result.imageBase64, 'base64')

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

    // Update record with success
    const { data: updatedImage, error: updateError } = await supabase
      .from('post_images')
      .update({
        image_url: blobUrl,
        generation_status: 'completed',
      })
      .eq('id', imageRecord.id)
      .select()
      .single()

    if (updateError) {
      console.error('Failed to update image record:', updateError)
    }

    // Check if this is the first image for this post - if so, set as cover
    const { count } = await supabase
      .from('post_images')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId)
      .eq('generation_status', 'completed')

    if (count === 1) {
      // This is the first completed image - set as cover
      await supabase
        .from('post_images')
        .update({ is_cover: true })
        .eq('id', imageRecord.id)

      await supabase
        .from('generated_posts')
        .update({ cover_image_id: imageRecord.id })
        .eq('id', postId)
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
  try {
    const body: {
      postId: string
      newsItems: Array<{ dailyRepoId?: string; text: string }>
      enableDithering?: boolean
      ditheringGain?: number
    } = await request.json()
    const { postId, newsItems, enableDithering, ditheringGain } = body

    if (!postId || !newsItems || newsItems.length === 0) {
      return NextResponse.json(
        { error: 'postId and newsItems are required' },
        { status: 400 }
      )
    }

    const processingOptions: ImageProcessingOptions = {
      enableDithering: enableDithering ?? false,
      ditheringGain: ditheringGain ?? 1.0,
    }

    const supabase = await createClient()
    const results: Array<{ success: boolean; error?: string; imageId?: string }> = []

    // Process images sequentially to avoid API rate limits
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

        // Generate the image with processing options
        const result = await generateAndProcessImage(item.text, processingOptions)

        if (!result.success || !result.imageBase64) {
          await supabase
            .from('post_images')
            .update({
              generation_status: 'failed',
              error_message: result.error || 'Unknown error',
            })
            .eq('id', imageRecord.id)

          results.push({ success: false, error: result.error, imageId: imageRecord.id })
          continue
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
            })
            .eq('id', imageRecord.id)

          // Set as cover if first completed image
          const { count } = await supabase
            .from('post_images')
            .select('*', { count: 'exact', head: true })
            .eq('post_id', postId)
            .eq('generation_status', 'completed')

          if (count === 1) {
            await supabase
              .from('post_images')
              .update({ is_cover: true })
              .eq('id', imageRecord.id)

            await supabase
              .from('generated_posts')
              .update({ cover_image_id: imageRecord.id })
              .eq('id', postId)
          }

          results.push({ success: true, imageId: imageRecord.id })
          console.log(`[Gemini] Image generated successfully for postId=${postId}`)
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
