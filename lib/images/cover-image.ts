/**
 * Cover-Bilder eines Posts erzeugen (2026-10-19): Hauptbild (1408×792, Blob),
 * dazu best-effort E-Mail- und Desktop-Cover. Kern von POST /api/generate-image,
 * herausgezogen, weil der Artikel-Job das Cover jetzt serverseitig erzeugt
 * (Schritt „Assets“) — die Seite „AI Artikel erstellen“ hängt nicht mehr am
 * Browser. Die Route behält Auth und Rate-Limit und ruft diese Funktion auf.
 */
import { put } from '@vercel/blob'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  generateAndProcessImage, generateDesktopCover, generateEmailCover, generateSatiricalImage, type ImageProcessingOptions,
} from '@/lib/gemini/image-generator'

export interface CoverImageInput {
  postId: string
  newsText: string
  dailyRepoId?: string | null
  enableDithering?: boolean
  ditheringGain?: number
}

export type CoverImageResult =
  | { ok: true; image: unknown }
  | { ok: false; status: 500; error: string }

export async function generateCoverImagesForPost(input: CoverImageInput): Promise<CoverImageResult> {
  const { postId, dailyRepoId, newsText, enableDithering, ditheringGain } = input
  const supabase = createAdminClient()

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
  if (insertError || !imageRecord) {
    console.error('Failed to create image record:', insertError)
    return { ok: false, status: 500, error: 'Failed to create image record' }
  }

  const rawResult = await generateSatiricalImage(newsText, { fast: true, aspectRatio: 'landscape' })
  if (!rawResult.success || !rawResult.imageBase64) {
    await supabase.from('post_images').update({ generation_status: 'failed', error_message: rawResult.error || 'Unknown error' }).eq('id', imageRecord.id)
    return { ok: false, status: 500, error: rawResult.error || 'Image generation failed' }
  }

  const processingOptions: ImageProcessingOptions = {
    ...(enableDithering !== undefined ? { enableDithering } : {}),
    ...(ditheringGain !== undefined ? { ditheringGain } : {}),
    targetWidth: 1408,
    targetHeight: 792,
  }
  const result = await generateAndProcessImage(newsText, processingOptions, rawResult.imageBase64)
  if (!result.success || !result.imageBase64) {
    await supabase.from('post_images').update({ generation_status: 'failed', error_message: result.error || 'Processing failed' }).eq('id', imageRecord.id)
    return { ok: false, status: 500, error: result.error || 'Image processing failed' }
  }

  const imageBuffer = Buffer.from(result.imageBase64, 'base64')
  const fileName = `post-images/${postId}/${imageRecord.id}.png`
  let blobUrl: string
  try {
    const blob = await put(fileName, imageBuffer, { access: 'public', contentType: result.mimeType || 'image/png' })
    blobUrl = blob.url
  } catch (uploadError) {
    console.error('Failed to upload image:', uploadError)
    await supabase.from('post_images').update({ generation_status: 'failed', error_message: 'Failed to upload image to storage' }).eq('id', imageRecord.id)
    return { ok: false, status: 500, error: 'Failed to upload image' }
  }

  let rawBlobUrl: string | null = null
  try {
    const rawBlob = await put(`post-images/${postId}/${imageRecord.id}-raw.png`, Buffer.from(rawResult.imageBase64, 'base64'), { access: 'public', contentType: 'image/png' })
    rawBlobUrl = rawBlob.url
  } catch (rawUploadError) {
    console.error('Failed to upload raw image (non-fatal):', rawUploadError)
  }

  const { data: updatedImage, error: updateError } = await supabase
    .from('post_images')
    .update({ image_url: blobUrl, generation_status: 'completed', ...(rawBlobUrl ? { raw_image_url: rawBlobUrl } : {}) })
    .eq('id', imageRecord.id)
    .select()
    .single()
  if (updateError) console.error('Failed to update image record:', updateError)

  await supabase.from('post_images').update({ is_cover: true }).eq('id', imageRecord.id)
  await supabase.from('generated_posts').update({ cover_image_id: imageRecord.id }).eq('id', postId)

  try {
    const emailCover = await generateEmailCover(rawResult.imageBase64)
    const { data: emailRecord, error: emailInsertError } = await supabase
      .from('post_images')
      .insert({ post_id: postId, daily_repo_id: dailyRepoId || null, image_url: '', source_text: newsText.slice(0, 5000), generation_status: 'generating', image_type: 'cover_email' })
      .select()
      .single()
    if (!emailInsertError && emailRecord) {
      const emailBlob = await put(`post-images/${postId}/${emailRecord.id}-cover-email.png`, Buffer.from(emailCover.base64, 'base64'), { access: 'public', contentType: 'image/png' })
      await supabase.from('post_images').update({ image_url: emailBlob.url, generation_status: 'completed' }).eq('id', emailRecord.id)
      console.log(`[Gemini] Email cover generated successfully for postId=${postId}`)
    }
  } catch (emailError) {
    console.error('[Gemini] Email cover generation failed (non-fatal):', emailError)
  }

  try {
    const desktopCover = await generateDesktopCover(rawResult.imageBase64)
    const { data: desktopRecord } = await supabase
      .from('post_images')
      .insert({ post_id: postId, daily_repo_id: dailyRepoId || null, image_url: '', source_text: newsText.slice(0, 5000), generation_status: 'generating', image_type: 'cover_desktop' })
      .select()
      .single()
    if (desktopRecord) {
      const desktopBlob = await put(`post-images/${postId}/${desktopRecord.id}-cover-desktop.png`, Buffer.from(desktopCover.base64, 'base64'), { access: 'public', contentType: 'image/png' })
      await supabase.from('post_images').update({ image_url: desktopBlob.url, generation_status: 'completed' }).eq('id', desktopRecord.id)
      console.log(`[Gemini] Desktop cover generated successfully for postId=${postId}`)
    }
  } catch (desktopError) {
    console.error('[Gemini] Desktop cover generation failed (non-fatal):', desktopError)
  }

  return { ok: true, image: updatedImage }
}
