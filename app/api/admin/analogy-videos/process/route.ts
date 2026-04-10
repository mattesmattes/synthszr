import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { getSession } from '@/lib/auth/session'
import { generateAnalogyImage, generateFallbackImage, uploadAnalogyImage } from '@/lib/analogy/image-generator'
import { generateAnalogyAudio, uploadAnalogyAudio } from '@/lib/analogy/audio-generator'

export const maxDuration = 300

/**
 * Process the next pending analogy video job through the pipeline:
 * 1. Generate image (Nano Banana) → fallback on failure
 * 2. Generate audio (TTS)
 * 3. Mark as "review" (video compositing is Step 6, added later)
 *
 * Can be called by cron or admin session.
 */
export async function POST(request: NextRequest) {
  // Allow both cron and admin session auth
  const cronAuth = verifyCronAuth(request)
  if (!cronAuth.authorized) {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
    }
  }

  const supabase = createAdminClient()

  // Optional: process a specific job by ID
  const body = await request.json().catch(() => ({}))
  const specificId = body?.videoId

  // Find next job to process
  let query = supabase
    .from('analogy_videos')
    .select('*')

  if (specificId) {
    query = query.eq('id', specificId)
  } else {
    query = query.in('status', ['pending', 'generating_image', 'generating_audio'])
  }

  const { data: job, error: fetchError } = await query
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (fetchError || !job) {
    return NextResponse.json({ message: 'No pending jobs', processed: 0 })
  }

  console.log(`[AnalogyProcess] Processing job ${job.id}: "${job.analogy_text.slice(0, 60)}..."`)

  // Check max attempts
  if (job.attempts >= job.max_attempts) {
    await supabase
      .from('analogy_videos')
      .update({ status: 'failed', error_message: 'Max attempts reached', updated_at: new Date().toISOString() })
      .eq('id', job.id)
    return NextResponse.json({ message: 'Job exceeded max attempts', jobId: job.id, status: 'failed' })
  }

  // Increment attempts
  await supabase
    .from('analogy_videos')
    .update({ attempts: job.attempts + 1, updated_at: new Date().toISOString() })
    .eq('id', job.id)

  try {
    // === Step 1: Image Generation ===
    if (!job.image_url) {
      await supabase
        .from('analogy_videos')
        .update({ status: 'generating_image', progress: 10, updated_at: new Date().toISOString() })
        .eq('id', job.id)

      console.log('[AnalogyProcess] Generating image...')
      let imageResult = await generateAnalogyImage(job.image_prompt)

      let isFallback = false
      if (!imageResult.success || !imageResult.imageBuffer) {
        console.log('[AnalogyProcess] Image gen failed, using fallback:', imageResult.error)
        imageResult = await generateFallbackImage(job.analogy_text, job.context_text || '')
        isFallback = true

        if (!imageResult.success || !imageResult.imageBuffer) {
          throw new Error(`Image generation failed: ${imageResult.error}`)
        }
      }

      // Upload to Vercel Blob
      const imageUrl = await uploadAnalogyImage(
        job.id,
        imageResult.imageBuffer,
        imageResult.mimeType || 'image/png',
        isFallback
      )

      await supabase
        .from('analogy_videos')
        .update({
          image_url: imageUrl,
          image_fallback: isFallback,
          progress: 40,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      console.log(`[AnalogyProcess] Image uploaded: ${imageUrl.slice(0, 80)}... (fallback: ${isFallback})`)
    }

    // === Step 2: Audio Generation ===
    if (!job.audio_url) {
      await supabase
        .from('analogy_videos')
        .update({ status: 'generating_audio', progress: 50, updated_at: new Date().toISOString() })
        .eq('id', job.id)

      console.log('[AnalogyProcess] Generating audio...')
      const audioResult = await generateAnalogyAudio(job.analogy_text)

      if (!audioResult.success || !audioResult.audioBuffer) {
        throw new Error(`Audio generation failed: ${audioResult.error}`)
      }

      const audioUrl = await uploadAnalogyAudio(job.id, audioResult.audioBuffer)

      await supabase
        .from('analogy_videos')
        .update({
          audio_url: audioUrl,
          audio_duration_seconds: audioResult.durationSeconds,
          progress: 80,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      console.log(`[AnalogyProcess] Audio uploaded: ${audioUrl.slice(0, 80)}...`)
    }

    // === Step 3: Mark as review ===
    // Video compositing (Remotion) will be added in Phase 4.
    // For now, image + audio are the deliverables for review.
    await supabase
      .from('analogy_videos')
      .update({
        status: 'review',
        progress: 100,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    console.log(`[AnalogyProcess] Job ${job.id} complete → review`)

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: 'review',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[AnalogyProcess] Job ${job.id} failed:`, message)

    await supabase
      .from('analogy_videos')
      .update({
        status: 'failed',
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    return NextResponse.json({
      success: false,
      jobId: job.id,
      error: message,
    }, { status: 500 })
  }
}
