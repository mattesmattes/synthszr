import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { getSession } from '@/lib/auth/session'
import { generateAnalogyImage, generateFallbackImage, uploadAnalogyImage } from '@/lib/analogy/image-generator'
import { generateAnalogyAudio, uploadAnalogyAudio } from '@/lib/analogy/audio-generator'
import { generateAnalogyVideo, uploadAnalogyVideo } from '@/lib/analogy/video-generator'
import { generateMachineVideo, uploadMachineVideo } from '@/lib/analogy/machine-video-generator'
import type { MachineScript } from '@/lib/analogy/machine-extractor'

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

  // Optional: process a specific job by ID, or only generate video for existing assets
  const body = await request.json().catch(() => ({}))
  const specificId = body?.videoId
  const videoOnly = body?.videoOnly === true // Skip image+audio, only generate video

  // Find next job to process
  let query = supabase
    .from('analogy_videos')
    .select('*')

  if (specificId) {
    // When targeting a specific ID, process regardless of status (allows re-processing review items)
    query = query.eq('id', specificId)
  } else {
    query = query.in('status', ['pending', 'generating_image', 'generating_audio', 'compositing'])
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
    // === MACHINE PIPELINE ===
    if (job.video_type === 'machine') {
      if (!job.video_url && job.script_data) {
        await supabase
          .from('analogy_videos')
          .update({ status: 'compositing', progress: 20, updated_at: new Date().toISOString() })
          .eq('id', job.id)

        console.log('[MachineProcess] Generating terminal video via Veo...')
        const videoResult = await generateMachineVideo(job.script_data as MachineScript)

        if (videoResult.success && videoResult.videoBuffer) {
          const videoUrl = await uploadMachineVideo(job.id, videoResult.videoBuffer)
          await supabase
            .from('analogy_videos')
            .update({
              video_url: videoUrl,
              video_duration_seconds: videoResult.durationSeconds,
              status: 'review',
              progress: 100,
              error_message: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)
          console.log(`[MachineProcess] Video uploaded: ${videoUrl.slice(0, 80)}...`)
        } else {
          console.error('[MachineProcess] Video generation failed:', videoResult.error)
          await supabase
            .from('analogy_videos')
            .update({
              status: 'review', // Still go to review — script_data is the deliverable
              progress: 100,
              error_message: `Video gen failed: ${videoResult.error}`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)
        }
      } else {
        // No script_data or already has video
        await supabase
          .from('analogy_videos')
          .update({ status: 'review', progress: 100, updated_at: new Date().toISOString() })
          .eq('id', job.id)
      }

      return NextResponse.json({ success: true, jobId: job.id, status: 'review', type: 'machine' })
    }

    // === ANALOGY PIPELINE ===
    // Step 1: Image Generation (skip if videoOnly)
    if (!job.image_url && !videoOnly) {
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

    // === Step 2: Audio Generation (skip if videoOnly) ===
    if (!job.audio_url && !videoOnly) {
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

    // === Step 3: Video Compositing ===
    // Re-read job to get latest URLs (in case of crash recovery)
    const { data: updatedJob } = await supabase
      .from('analogy_videos')
      .select('image_url, audio_url, audio_duration_seconds')
      .eq('id', job.id)
      .single()

    const currentImageUrl = updatedJob?.image_url || job.image_url
    const currentAudioUrl = updatedJob?.audio_url || job.audio_url

    if (!job.video_url && currentImageUrl && currentAudioUrl) {
      await supabase
        .from('analogy_videos')
        .update({ status: 'compositing', progress: 85, updated_at: new Date().toISOString() })
        .eq('id', job.id)

      console.log('[AnalogyProcess] Compositing video...')
      const videoResult = await generateAnalogyVideo({
        imageUrl: currentImageUrl,
        audioUrl: currentAudioUrl,
        analogyText: job.analogy_text,
        contextText: job.context_text || '',
      })

      if (!videoResult.success || !videoResult.videoBuffer) {
        // Video compositing is non-fatal — still go to review with image+audio
        console.error('[AnalogyProcess] Video compositing failed (non-fatal):', videoResult.error)
      } else {
        const videoUrl = await uploadAnalogyVideo(job.id, videoResult.videoBuffer)

        await supabase
          .from('analogy_videos')
          .update({
            video_url: videoUrl,
            video_duration_seconds: videoResult.durationSeconds,
            progress: 95,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)

        console.log(`[AnalogyProcess] Video uploaded: ${videoUrl.slice(0, 80)}...`)
      }
    }

    // === Step 4: Mark as review ===
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
