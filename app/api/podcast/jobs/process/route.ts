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
  stripDirectiveTags,
  stripEmotionTags,
  extractEmotionTag,
  emotionToInstruction,
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

// Minimum acceptable MP3 buffer size in bytes.
// OpenAI TTS occasionally returns ~200-byte empty responses with HTTP 200.
// At ~16 KB/sec for 128 kbps MP3, a real 1-second take is ≥ 16 KB; we set
// a conservative floor of 2 KB so we don't false-positive on short
// directives like "Ja." but still catch every silent take we've seen.
const MIN_AUDIO_BYTES = 2048
const SUSPECT_SHORT_AUDIO_MARKER = 'suspect-short-audio-buffer'

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

      // Check if it's a retryable error (5xx, connection errors, stream termination,
      // or a suspect-short audio buffer — the silent-take failure mode)
      const isRetryable =
        lastError.message.includes('503') ||
        lastError.message.includes('502') ||
        lastError.message.includes('500') ||
        lastError.message.includes('429') ||
        lastError.message.includes('connection') ||
        lastError.message.includes('ECONNREFUSED') ||
        lastError.message.includes('timeout') ||
        lastError.message.includes('terminated') ||
        lastError.message.includes('ECONNRESET') ||
        lastError.message.includes('fetch failed') ||
        lastError.message.includes(SUSPECT_SHORT_AUDIO_MARKER)

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

async function generateSegmentOpenAI(
  text: string,
  voice: OpenAIVoice,
  model: string = 'tts-1'
): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  // gpt-4o-mini-tts: extract emotion tag → instructions parameter
  // tts-1/tts-1-hd: strip emotion tags (not supported)
  const isGpt4oMiniTts = model === 'gpt-4o-mini-tts'
  let cleanText: string
  let instructions: string | undefined

  let emotionTag: string | null = null

  if (isGpt4oMiniTts) {
    const { emotion, cleanText: stripped } = extractEmotionTag(text)
    emotionTag = emotion
    // Strip remaining emotion tags from the text — only the first one becomes
    // the instructions parameter, any mid-sentence tags would be spoken aloud
    cleanText = prepareTTSText(stripEmotionTags(stripped))
    instructions = emotionToInstruction(emotion)
  } else {
    cleanText = prepareTTSText(stripEmotionTags(text))
  }

  if (!cleanText.trim()) return Buffer.alloc(0)

  console.log(`[TTS-OpenAI] model=${model}, voice=${voice}, len=${cleanText.length}${emotionTag ? `, emotion="${emotionTag}"` : ', tags=stripped'}`)

  return withRetry(async () => {
    const body: Record<string, unknown> = {
      model,
      voice,
      input: cleanText,
      response_format: 'mp3',
    }
    if (instructions) {
      body.instructions = instructions
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenAI TTS API error: ${response.status} - ${errorText}`)
      }

      const buf = Buffer.from(await response.arrayBuffer())
      // Silent-take mitigation: OpenAI occasionally returns a tiny MP3
      // (a few hundred bytes) without throwing. Treat as transient and
      // let withRetry have another go.
      if (buf.length < MIN_AUDIO_BYTES) {
        throw new Error(
          `${SUSPECT_SHORT_AUDIO_MARKER}: got ${buf.length}B for "${cleanText.slice(0, 60)}…"`
        )
      }
      return buf
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`OpenAI TTS timeout after 30000ms`)
      }
      throw err
    } finally {
      clearTimeout(timeoutId)
    }
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

    const segments: AudioSegment[] = []
    const segmentMetadata: SegmentMetadata[] = []

    const timestamp = Date.now()
    const safeTitle = (job.title || 'podcast')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50)

    console.log(`[Podcast Jobs] Generating ${lines.length} segments with OpenAI (parallel batches of ${TTS_BATCH_SIZE})`)

    // Generate TTS + upload each segment immediately (don't accumulate in memory)
    const segmentUrls: string[] = new Array(lines.length).fill('')
    const segmentBuffers: Array<{ buffer: Buffer; speaker: 'HOST' | 'GUEST'; text: string }> = []
    let completedLines = 0

    for (let batchStart = 0; batchStart < lines.length; batchStart += TTS_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + TTS_BATCH_SIZE, lines.length)
      const batch = lines.slice(batchStart, batchEnd)

      const batchStartTime = Date.now()

      // Process batch in parallel: TTS + upload per segment
      const batchPromises = batch.map(async (line, batchIndex) => {
        const globalIndex = batchStart + batchIndex
        const voiceId = line.speaker === 'HOST' ? job.host_voice_id : job.guest_voice_id

        // Strip directive tags ([beat], [short pause], etc.) before TTS — they're script annotations, not speech
        const ttsText = stripDirectiveTags(line.text)

        // Skip TTS for lines that become empty after stripping (e.g., "HOST: [longer pause]")
        if (!ttsText) {
          console.log(`[Podcast Jobs] Skipping empty line ${globalIndex + 1} after directive strip`)
          return null
        }

        // Defensive guard against hallucinated tags: if NOTHING but bracketed
        // tags remains after we also strip every "[…]" block, OpenAI TTS
        // returns 0 bytes (the cleanText becomes empty server-side).
        // We've seen ChatGPT-generated scripts produce "[waiting]",
        // "[pondering]", etc. — none of which are in DIRECTIVE_TAG_NAMES.
        // Drop the line here so the silent-take guard doesn't have to.
        const visibleAfterAllTags = ttsText.replace(/\[[^\]]*\]/g, '').trim()
        if (!visibleAfterAllTags) {
          console.log(
            `[Podcast Jobs] Skipping line ${globalIndex + 1} — only bracketed tags after strip: "${line.text.slice(0, 80)}"`
          )
          return null
        }

        const buffer = await generateSegmentOpenAI(ttsText, voiceId as OpenAIVoice, job.model || 'gpt-4o-mini-tts')

        // Upload segment immediately after generation
        const fileName = `podcasts/${safeTitle}-${timestamp}-seg${globalIndex.toString().padStart(3, '0')}.mp3`
        const blob = await put(fileName, buffer, {
          access: 'public',
          contentType: 'audio/mpeg',
        })

        completedLines++
        void supabase
          .from('podcast_jobs')
          .update({
            progress: Math.round((completedLines / lines.length) * 90),
            current_line: completedLines,
          })
          .eq('id', job.id)

        return {
          buffer,
          index: globalIndex,
          speaker: line.speaker as 'HOST' | 'GUEST',
          text: line.text,
          url: blob.url,
        }
      })

      const batchResults = await Promise.all(batchPromises)

      // Store results in order (skip null entries from empty directive-only lines)
      for (const result of batchResults) {
        if (!result) continue
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
      // TTS phase uses 0-90%, concatenation phase uses 90-100%
      const progress = Math.round((batchEnd / lines.length) * 90)
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

    // Post-batch verification: catch any silent take that slipped past the
    // per-call retry guard. Fails the job before mixing rather than baking
    // a 20-second silence into the final podcast.
    const undersizedSegments: Array<{ index: number; bytes: number; preview: string }> = []
    for (let i = 0; i < segmentBuffers.length; i++) {
      const seg = segmentBuffers[i]
      if (!seg) continue
      if (seg.buffer.length < MIN_AUDIO_BYTES) {
        undersizedSegments.push({
          index: i,
          bytes: seg.buffer.length,
          preview: seg.text.slice(0, 80),
        })
      }
    }
    if (undersizedSegments.length > 0) {
      const detail = undersizedSegments
        .map((s) => `#${s.index + 1} (${s.bytes}B): "${s.preview}…"`)
        .join('\n  ')
      throw new Error(
        `Silent-take guard tripped: ${undersizedSegments.length} segment(s) below ${MIN_AUDIO_BYTES} bytes — aborting before mix.\n  ${detail}`
      )
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
        overlapping: lines[i]?.overlapping,
        articleIndex: lines[i]?.articleIndex,
      })

      const segmentDuration = seg.buffer.length / (128 * 1024 / 8)
      segmentMetadata.push({
        index: i,
        speaker: seg.speaker,
        text: seg.text,
        startTime: cumulativeTime,
        durationEstimate: segmentDuration,
        articleIndex: lines[i]?.articleIndex,
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

    const { data: activeIntermezzo } = await supabase
      .from('podcast_audio_files')
      .select('url')
      .eq('type', 'intermezzo')
      .eq('is_active', true)
      .single()

    if (activeIntro?.url) {
      crossfadeOptions.introUrl = activeIntro.url
    }
    if (activeOutro?.url) {
      crossfadeOptions.outroUrl = activeOutro.url
    }
    if (activeIntermezzo?.url) {
      crossfadeOptions.intermezzoUrl = activeIntermezzo.url
    } else if (crossfadeOptions.includeIntermezzo) {
      console.log('[Podcast Jobs] Intermezzo enabled but no active intermezzo audio file found — disabling')
      crossfadeOptions.includeIntermezzo = false
    }

    // Report concatenation progress (90-100% range)
    crossfadeOptions.onProgress = async (concatPercent: number) => {
      const overallProgress = 90 + Math.round(concatPercent * 10 / 100)
      await supabase
        .from('podcast_jobs')
        .update({ progress: Math.min(overallProgress, 99) })
        .eq('id', job.id)
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
