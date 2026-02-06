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
import { createClient } from '@/lib/supabase/server'
import { put } from '@vercel/blob'
import {
  parseScriptText,
  type PodcastLine,
  type OpenAIVoice,
  type ElevenLabsModel,
  type SegmentMetadata,
} from '@/lib/tts/elevenlabs-tts'

// Maximum duration for this function (5 minutes on Pro, adjust as needed)
export const maxDuration = 300

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
}

async function generateSegmentOpenAI(
  text: string,
  voice: OpenAIVoice,
  model: string = 'tts-1'
): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  const cleanText = prepareTTSText(stripEmotionTags(text))

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
}

export async function POST(request: NextRequest) {
  // Note: This endpoint should be protected in production
  // For now, we allow it to be called internally

  const body = await request.json().catch(() => ({}))
  const requestedJobId = body.jobId as string | undefined

  const supabase = await createClient()

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
    const segmentBuffers: Buffer[] = []
    const segmentMetadata: SegmentMetadata[] = []

    console.log(`[Podcast Jobs] Generating ${lines.length} segments with ${provider}`)

    // Generate each segment
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const voiceId = line.speaker === 'HOST' ? job.host_voice_id : job.guest_voice_id

      const startTime = Date.now()
      let buffer: Buffer

      if (provider === 'openai') {
        buffer = await generateSegmentOpenAI(line.text, voiceId as OpenAIVoice, job.model || 'tts-1')
      } else {
        buffer = await generateSegmentElevenLabs(line.text, voiceId, job.model || 'eleven_v3')
      }

      const elapsed = Date.now() - startTime
      console.log(`[Podcast Jobs] Line ${i + 1}/${lines.length}: ${buffer.length} bytes in ${elapsed}ms`)

      segmentBuffers.push(buffer)

      // Calculate duration estimate (MP3 at 128kbps)
      const segmentDuration = buffer.length / (128 * 1024 / 8)

      segmentMetadata.push({
        index: i,
        speaker: line.speaker,
        text: line.text,
        startTime: segmentMetadata.length > 0
          ? segmentMetadata[segmentMetadata.length - 1].startTime + segmentMetadata[segmentMetadata.length - 1].durationEstimate
          : 0,
        durationEstimate: segmentDuration,
      })

      // Update progress
      const progress = Math.round(((i + 1) / lines.length) * 100)
      await supabase
        .from('podcast_jobs')
        .update({
          progress,
          current_line: i + 1,
        })
        .eq('id', job.id)

      // Small delay to avoid rate limiting
      if (i < lines.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    // Upload segments to Vercel Blob
    const timestamp = Date.now()
    const safeTitle = (job.title || 'podcast')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50)

    const segmentUrls: string[] = []
    for (let i = 0; i < segmentBuffers.length; i++) {
      const fileName = `podcasts/${safeTitle}-${timestamp}-seg${i.toString().padStart(3, '0')}.mp3`
      const blob = await put(fileName, segmentBuffers[i], {
        access: 'public',
        contentType: 'audio/mpeg',
      })
      segmentUrls.push(blob.url)
    }

    // Also create combined audio (simple concatenation)
    const combinedBuffer = Buffer.concat(segmentBuffers)
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

    return NextResponse.json({
      success: true,
      jobId: job.id,
      audioUrl: combinedBlob.url,
      durationSeconds: totalDuration,
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
