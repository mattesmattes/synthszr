/**
 * POST /api/podcast/jobs/process
 * Process a pending podcast generation job
 *
 * This endpoint processes jobs segment by segment, updating progress as it goes.
 * It can be called with a specific jobId or will pick the oldest pending job.
 *
 * Uses maxDuration to allow longer processing time.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { put } from '@vercel/blob'
import {
  parseScriptText,
  type OpenAIVoice,
  type SegmentMetadata,
} from '@/lib/tts/elevenlabs-tts'
import { concatenateWithCrossfade, mixingSettingsToCrossfadeOptions, type AudioSegment } from '@/lib/audio/crossfade'
import { getTTSSettings } from '@/lib/tts/openai-tts'
import { getPersonalityState, advanceState } from '@/lib/podcast/personality'

// Maximum duration for this function (Vercel Pro max is 800 seconds)
export const maxDuration = 800

// Parallel TTS batch size (to speed up generation while respecting rate limits)
const TTS_BATCH_SIZE = 5

// Retry settings for transient API errors
const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY_MS = 1000

/**
 * Retry wrapper with exponential backoff for transient API errors
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  context: string,
  maxRetries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Check if it's a retryable error (5xx, connection errors)
      const isRetryable =
        lastError.message.includes('503') ||
        lastError.message.includes('502') ||
        lastError.message.includes('500') ||
        lastError.message.includes('429') ||
        lastError.message.includes('connection') ||
        lastError.message.includes('ECONNREFUSED') ||
        lastError.message.includes('timeout')

      if (!isRetryable || attempt === maxRetries) {
        throw lastError
      }

      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt)
      console.log(`[Podcast Jobs] ${context} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${lastError.message}`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

// TTS Pronunciation replacements
const TTS_PRONUNCIATIONS: Record<string, string> = {
  'Synthszr': 'Synthesizer',
  'synthszr': 'synthesizer',
  'SYNTHSZR': 'SYNTHESIZER',
}

function prepareTTSText(text: string): string {
  let result = text
  for (const [from, to] of Object.entries(TTS_PRONUNCIATIONS)) {
    result = result.replaceAll(from, to)
  }
  return result
}

function stripEmotionTags(text: string): string {
  return text.replace(/\[(?:cheerfully|thoughtfully|seriously|excitedly|skeptically|laughing|sighing|whispering|interrupting|curiously|dramatically|calmly|enthusiastically)\]\s*/gi, '').trim()
}

async function generateSegmentElevenLabs(
  text: string,
  voiceId: string,
  model: string = 'eleven_v3'
): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set')

  const ttsText = prepareTTSText(text)

  return withRetry(async () => {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: ttsText,
        model_id: model,
        output_format: 'mp3_44100_128',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`)
    }

    return Buffer.from(await response.arrayBuffer())
  }, `ElevenLabs TTS (${voiceId})`)
}

async function generateSegmentOpenAI(
  text: string,
  voice: OpenAIVoice,
  model: string = 'tts-1'
): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  const cleanText = prepareTTSText(stripEmotionTags(text))

  return withRetry(async () => {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        voice,
        input: cleanText,
        response_format: 'mp3',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI TTS API error: ${response.status} - ${errorText}`)
    }

    return Buffer.from(await response.arrayBuffer())
  }, `OpenAI TTS (${voice})`)
}

export async function POST(request: NextRequest) {
  // Note: This endpoint should be protected in production
  // For now, we allow it to be called internally

  const body = await request.json().catch(() => ({}))
  const requestedJobId = body.jobId as string | undefined

  const supabase = createAdminClient()

  // Get job to process
  let job
  if (requestedJobId) {
    const { data, error } = await supabase
      .from('podcast_jobs')
      .select('*')
      .eq('id', requestedJobId)
      .in('status', ['pending', 'processing'])
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Job not found or already completed' }, { status: 404 })
    }
    job = data
  } else {
    // Get oldest pending job
    const { data, error } = await supabase
      .from('podcast_jobs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (error || !data) {
      return NextResponse.json({ message: 'No pending jobs' })
    }
    job = data
  }

  console.log(`[Podcast Jobs] Processing job ${job.id}`)

  // Mark as processing
  await supabase
    .from('podcast_jobs')
    .update({
      status: 'processing',
      started_at: new Date().toISOString(),
      attempts: job.attempts + 1,
    })
    .eq('id', job.id)

  try {
    // Parse script
    const lines = parseScriptText(job.script)

    if (lines.length === 0) {
      throw new Error('Script has no valid dialogue lines')
    }

    const provider = job.provider || 'elevenlabs'
    const segments: AudioSegment[] = []
    const segmentMetadata: SegmentMetadata[] = []

    const timestamp = Date.now()
    const safeTitle = (job.title || 'podcast')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50)

    console.log(`[Podcast Jobs] Generating ${lines.length} segments with ${provider} (parallel batches of ${TTS_BATCH_SIZE})`)

    // Generate TTS + upload each segment immediately (don't accumulate in memory)
    const segmentUrls: string[] = new Array(lines.length).fill('')
    const segmentBuffers: Array<{ buffer: Buffer; speaker: 'HOST' | 'GUEST'; text: string }> = []

    for (let batchStart = 0; batchStart < lines.length; batchStart += TTS_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + TTS_BATCH_SIZE, lines.length)
      const batch = lines.slice(batchStart, batchEnd)

      const batchStartTime = Date.now()

      // Process batch in parallel: TTS + upload per segment
      const batchPromises = batch.map(async (line, batchIndex) => {
        const globalIndex = batchStart + batchIndex
        const voiceId = line.speaker === 'HOST' ? job.host_voice_id : job.guest_voice_id

        let buffer: Buffer
        if (provider === 'openai') {
          buffer = await generateSegmentOpenAI(line.text, voiceId as OpenAIVoice, job.model || 'tts-1')
        } else {
          buffer = await generateSegmentElevenLabs(line.text, voiceId, job.model || 'eleven_v3')
        }

        // Upload segment immediately after generation
        const fileName = `podcasts/${safeTitle}-${timestamp}-seg${globalIndex.toString().padStart(3, '0')}.mp3`
        const blob = await put(fileName, buffer, {
          access: 'public',
          contentType: 'audio/mpeg',
        })

        return {
          buffer,
          index: globalIndex,
          speaker: line.speaker as 'HOST' | 'GUEST',
          text: line.text,
          url: blob.url,
        }
      })

      const batchResults = await Promise.all(batchPromises)

      // Store results in order
      for (const result of batchResults) {
        segmentUrls[result.index] = result.url
        segmentBuffers[result.index] = {
          buffer: result.buffer,
          speaker: result.speaker,
          text: result.text,
        }
      }

      const batchElapsed = Date.now() - batchStartTime
      console.log(`[Podcast Jobs] Batch ${Math.floor(batchStart / TTS_BATCH_SIZE) + 1}: lines ${batchStart + 1}-${batchEnd}/${lines.length} in ${batchElapsed}ms`)

      // Update progress + persist segment URLs so far (crash recovery)
      const progress = Math.round((batchEnd / lines.length) * 100)
      await supabase
        .from('podcast_jobs')
        .update({
          progress,
          current_line: batchEnd,
          segment_urls: segmentUrls.filter(Boolean),
        })
        .eq('id', job.id)

      // Small delay between batches to avoid rate limiting
      if (batchEnd < lines.length) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }

    // Build segments + metadata arrays for concatenation
    let cumulativeTime = 0
    for (let i = 0; i < segmentBuffers.length; i++) {
      const seg = segmentBuffers[i]
      if (!seg) continue

      segments.push({
        buffer: seg.buffer,
        speaker: seg.speaker,
        text: seg.text,
      })

      const segmentDuration = seg.buffer.length / (128 * 1024 / 8)
      segmentMetadata.push({
        index: i,
        speaker: seg.speaker,
        text: seg.text,
        startTime: cumulativeTime,
        durationEstimate: segmentDuration,
      })
      cumulativeTime += segmentDuration
    }

    // Read mixing settings from DB and apply to crossfade
    const ttsSettings = await getTTSSettings()
    const crossfadeOptions = mixingSettingsToCrossfadeOptions(ttsSettings.mixing_settings)

    // Load active intro/outro URLs from podcast_audio_files
    const { data: activeIntro } = await supabase
      .from('podcast_audio_files')
      .select('url')
      .eq('type', 'intro')
      .eq('is_active', true)
      .single()

    const { data: activeOutro } = await supabase
      .from('podcast_audio_files')
      .select('url')
      .eq('type', 'outro')
      .eq('is_active', true)
      .single()

    if (activeIntro?.url) {
      crossfadeOptions.introUrl = activeIntro.url
    }
    if (activeOutro?.url) {
      crossfadeOptions.outroUrl = activeOutro.url
    }

    const combinedBuffer = await concatenateWithCrossfade(segments, crossfadeOptions)
    const combinedFileName = `podcasts/${safeTitle}-${timestamp}.mp3`
    const combinedBlob = await put(combinedFileName, combinedBuffer, {
      access: 'public',
      contentType: 'audio/mpeg',
    })

    // Calculate total duration
    const totalDuration = Math.round(combinedBuffer.length / (128 * 1024 / 8))

    console.log(`[Podcast Jobs] Job ${job.id} completed: ${segmentUrls.length} segments, ${totalDuration}s`)

    // Mark as completed
    await supabase
      .from('podcast_jobs')
      .update({
        status: 'completed',
        progress: 100,
        audio_url: combinedBlob.url,
        segment_urls: segmentUrls,
        segment_metadata: segmentMetadata,
        duration_seconds: totalDuration,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    // Auto-link to post_podcasts for ALL locales if this job has a post_id
    // This ensures the podcast is immediately available in the frontend for de, en, cs, nds
    if (job.post_id) {
      const SUPPORTED_LOCALES = ['de', 'en', 'cs', 'nds']

      console.log(`[Podcast Jobs] Linking job ${job.id} to post ${job.post_id} for all locales`)

      for (const locale of SUPPORTED_LOCALES) {
        const { error: upsertError } = await supabase
          .from('post_podcasts')
          .upsert({
            post_id: job.post_id,
            locale,
            status: 'completed',
            audio_url: combinedBlob.url,
            duration_seconds: totalDuration,
            script_content: job.script,
          }, { onConflict: 'post_id,locale' })

        if (upsertError) {
          console.error(`[Podcast Jobs] Failed to link locale ${locale}:`, upsertError)
        }
      }

      console.log(`[Podcast Jobs] Linked to post_podcasts for locales: ${SUPPORTED_LOCALES.join(', ')}`)
    }

    // Evolve personality state AFTER successful audio generation
    // This ensures test scripts (script-only, no audio) don't advance the personality.
    const LOCALE_TO_TTS_LANG: Record<string, string> = { de: 'de', en: 'en', cs: 'en', nds: 'en' }
    const personalityLocale = LOCALE_TO_TTS_LANG[job.source_locale] || 'en'
    try {
      const personalityState = await getPersonalityState(personalityLocale)
      await advanceState(personalityState, job.script)
      console.log(`[Podcast Jobs] Personality advanced for locale "${personalityLocale}" (episode #${personalityState.episode_count + 1})`)
    } catch (personalityError) {
      // Non-fatal: don't fail the job if personality evolution fails
      console.error(`[Podcast Jobs] Personality evolution failed (non-fatal):`, personalityError)
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      audioUrl: combinedBlob.url,
      durationSeconds: totalDuration,
      linkedToPost: job.post_id || null,
    })
  } catch (error) {
    console.error(`[Podcast Jobs] Job ${job.id} failed:`, error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Mark as failed
    await supabase
      .from('podcast_jobs')
      .update({
        status: 'failed',
        error_message: errorMessage,
      })
      .eq('id', job.id)

    return NextResponse.json(
      { error: errorMessage, jobId: job.id },
      { status: 500 }
    )
  }
}
