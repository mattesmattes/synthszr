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
import { getSession } from '@/lib/auth/session'
import { put } from '@vercel/blob'
import { parseScriptText, type SegmentMetadata } from '@/lib/tts/elevenlabs-tts'
import { concatenateWithCrossfade, mixingSettingsToCrossfadeOptions, type AudioSegment } from '@/lib/audio/crossfade'
import { estimateAudioDurationSec } from '@/lib/audio/wav'
import { getTTSSettings } from '@/lib/tts/openai-tts'
import { isSpeakable, prepareLineForTTS, type TTSProviderId } from '@/lib/tts/line-delivery'
import { defaultModelFor, renderLine } from '@/lib/tts/render-line'
import { MIN_AUDIO_BYTES } from '@/lib/tts/retry'
import { getPersonalityState, advanceState } from '@/lib/podcast/personality'
import { extractEpisodeMemory, consumeMemoryAwakeningSlot } from '@/lib/podcast/memory'

// Maximum duration for this function (Vercel Pro max is 800 seconds)
export const maxDuration = 800

// Parallel TTS batch size (to speed up generation while respecting rate limits)
const TTS_BATCH_SIZE = 5
// Gemini-TTS: Ratenlimits der 3.8-Modelle sind nicht dokumentiert, deshalb
// vorsichtiger; 429 wartet in gemini-tts.ts auf Retry-After.
const GEMINI_TTS_BATCH_SIZE = 3

export async function POST(request: NextRequest) {
  // Nur Admin (einziger Aufrufer: Podcast-Studio /admin/audio). Verhindert, dass
  // Fremde den teuren 800s-Worker triggern oder Jobstatus manipulieren.
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

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

    // Anbieter je Job: 'gemini' aus dem Podcast Studio, alles andere wie bisher
    // OpenAI (die Spalte hat den Default 'elevenlabs' aus der Anfangszeit).
    const provider: TTSProviderId = job.provider === 'gemini' ? 'gemini' : 'openai'
    const ttsModel: string = job.model || defaultModelFor(provider)
    const batchSize = provider === 'gemini' ? GEMINI_TTS_BATCH_SIZE : TTS_BATCH_SIZE

    console.log(`[Podcast Jobs] Generating ${lines.length} segments with ${provider === 'gemini' ? 'Gemini' : 'OpenAI'} ${ttsModel} (parallel batches of ${batchSize})`)

    // Generate TTS + upload each segment immediately (don't accumulate in memory)
    const segmentUrls: string[] = new Array(lines.length).fill('')
    const segmentBuffers: Array<{ buffer: Buffer; speaker: 'HOST' | 'GUEST'; text: string }> = []
    let completedLines = 0

    for (let batchStart = 0; batchStart < lines.length; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, lines.length)
      const batch = lines.slice(batchStart, batchEnd)

      const batchStartTime = Date.now()

      // Process batch in parallel: TTS + upload per segment
      const batchPromises = batch.map(async (line, batchIndex) => {
        const globalIndex = batchStart + batchIndex
        const voiceId = line.speaker === 'HOST' ? job.host_voice_id : job.guest_voice_id

        // Text und Anweisung je Anbieter (lib/tts/line-delivery.ts): OpenAI
        // entfernt Pausen-Tags und Klammern, Gemini macht aus der Anweisung am
        // Zeilenanfang `style` und aus Pausen/Lauten Inline-Tags.
        const delivery = prepareLineForTTS({ provider, model: ttsModel, text: line.text })

        // Defensive guard against hallucinated tags: lines that are nothing
        // but bracketed tags ("HOST: [longer pause]", "[waiting]") would come
        // back as 0 bytes and trip the silent-take guard. Drop them here.
        if (!isSpeakable(delivery)) {
          console.log(
            `[Podcast Jobs] Skipping line ${globalIndex + 1} — only bracketed tags after strip: "${line.text.slice(0, 80)}"`
          )
          return null
        }

        const rendered = await renderLine({ provider, model: ttsModel, voice: voiceId, text: line.text }, delivery)
        const buffer = rendered.buffer

        // Upload segment immediately after generation (Gemini: WAV, OpenAI: MP3)
        const fileName = `podcasts/${safeTitle}-${timestamp}-seg${globalIndex.toString().padStart(3, '0')}.${rendered.format}`
        const blob = await put(fileName, buffer, {
          access: 'public',
          contentType: rendered.contentType,
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
      console.log(`[Podcast Jobs] Batch ${Math.floor(batchStart / batchSize) + 1}: lines ${batchStart + 1}-${batchEnd}/${lines.length} in ${batchElapsed}ms`)

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
        intermezzoBefore: lines[i]?.intermezzoBefore,
      })

      const segmentDuration = estimateAudioDurationSec(seg.buffer)
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

    // Persönlichkeit, Episoden-Gedächtnis und Erweckungs-Slot nur für echte
    // Folgen (mit Post). Ein Testlauf ohne Post (Stimmenvergleich, Beispiel-
    // skript) würde sonst als Folge zählen und sich ins Gedächtnis schreiben
    // (Befund 2026-11-16: 20 Gedächtniszeilen ohne Post aus alten Tests).
    if (!job.post_id) {
      console.log(`[Podcast Jobs] Job ${job.id} ohne Post (Testlauf): Persönlichkeit und Gedächtnis bleiben unverändert`)
    } else {
      // Evolve personality state AFTER successful audio generation
      // This ensures test scripts (script-only, no audio) don't advance the personality.
      const LOCALE_TO_TTS_LANG: Record<string, string> = { de: 'de', en: 'en', cs: 'en', nds: 'en' }
      const personalityLocale = LOCALE_TO_TTS_LANG[job.source_locale] || 'en'
      let nextEpisodeNumber = 1
      try {
        const personalityState = await getPersonalityState(personalityLocale)
        nextEpisodeNumber = personalityState.episode_count + 1
        await advanceState(personalityState, job.script)
        console.log(`[Podcast Jobs] Personality advanced for locale "${personalityLocale}" (episode #${nextEpisodeNumber})`)
      } catch (personalityError) {
        // Non-fatal: don't fail the job if personality evolution fails
        console.error(`[Podcast Jobs] Personality evolution failed (non-fatal):`, personalityError)
      }

      // Persistent episode memory — distil the just-shipped script into a
      // structured row (topics, positions, gags, key moments) for use in
      // future script generations. Fire-and-forget on a copy of the
      // identifiers; failures stay non-fatal to the audio job.
      extractEpisodeMemory({
        jobId: job.id,
        postId: job.post_id,
        episodeNumber: nextEpisodeNumber,
        locale: personalityLocale,
        script: job.script,
        recordedAt: new Date().toISOString(),
      }).catch((memErr) => {
        console.warn('[Podcast Jobs] Memory extraction failed (non-fatal):', memErr)
      })

      // Burn one memory-awakening announcement slot. The next script-gen
      // for this locale only sees the awakening block while slots remain.
      consumeMemoryAwakeningSlot(personalityLocale).catch((slotErr) => {
        console.warn('[Podcast Jobs] Awakening slot decrement failed (non-fatal):', slotErr)
      })
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
