/**
 * POST /api/podcast/generate
 * Generate a podcast audio from a dialogue script
 *
 * Request body:
 * {
 *   script: string | PodcastLine[]  // Raw text or parsed lines
 *   hostVoiceId?: string            // Override host voice (optional)
 *   guestVoiceId?: string           // Override guest voice (optional)
 *   title?: string                  // Podcast title for filename
 * }
 *
 * Response:
 * {
 *   success: boolean
 *   audioUrl?: string
 *   durationSeconds?: number
 *   error?: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'

// Increase timeout for long podcast generation (up to 5 minutes)
export const maxDuration = 300
import { requireAdmin } from '@/lib/auth/session'
import { getTTSSettings } from '@/lib/tts/openai-tts'
import {
  generatePodcastDialogue,
  parseScriptText,
  estimatePodcastDuration,
  validateScriptEmotions,
  type PodcastLine,
  type OpenAIModel,
  type PodcastProgressEvent,
} from '@/lib/tts/elevenlabs-tts'

interface GeneratePodcastRequest {
  script: string | PodcastLine[]
  hostVoiceId?: string
  guestVoiceId?: string
  title?: string
  openaiModel?: OpenAIModel
}

export async function POST(request: NextRequest) {
  // Auth check - only admin can generate podcasts
  const authError = await requireAdmin(request)
  if (authError) return authError

  const stream = new URL(request.url).searchParams.get('stream') === 'true'

  try {
    const body: GeneratePodcastRequest = await request.json()

    if (!body.script) {
      return NextResponse.json(
        { error: 'Script is required' },
        { status: 400 }
      )
    }

    // Parse script if it's a string
    let lines: PodcastLine[]
    if (typeof body.script === 'string') {
      lines = parseScriptText(body.script)
    } else {
      lines = body.script
    }

    if (lines.length === 0) {
      return NextResponse.json(
        { error: 'Script has no valid dialogue lines. Use format: "HOST: text" or "GUEST: text"' },
        { status: 400 }
      )
    }

    // Validate emotion tags (warnings only, don't block)
    const warnings = validateScriptEmotions(lines)
    if (warnings.length > 0) {
      console.log('[Podcast] Script warnings:', warnings)
    }

    // Get voice settings from database or use overrides
    const settings = await getTTSSettings()

    const hostVoiceId = body.hostVoiceId || settings.podcast_host_voice_id
    const guestVoiceId = body.guestVoiceId || settings.podcast_guest_voice_id
    const openaiModel = body.openaiModel || 'gpt-4o-mini-tts'

    // Estimate duration before generation
    const estimatedDuration = estimatePodcastDuration(lines)
    console.log(`[Podcast] Generating podcast with ${lines.length} lines, estimated ${estimatedDuration}s`)
    console.log(`[Podcast] Model: ${openaiModel}`)
    console.log(`[Podcast] Voices - host: ${hostVoiceId}, guest: ${guestVoiceId}`)

    const safeTitle = (body.title || 'podcast')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50)

    const finalize = async (progress?: (e: PodcastProgressEvent) => void) => {
      const result = await generatePodcastDialogue(
        { lines, hostVoiceId, guestVoiceId, openaiModel },
        progress,
      )

      if (!result.success || !result.audioBuffer) {
        return { error: result.error || 'Failed to generate podcast audio' }
      }

      const timestamp = Date.now()
      const segmentUrls: string[] = []
      if (result.segmentBuffers && result.segmentBuffers.length > 0) {
        console.log(`[Podcast] Uploading ${result.segmentBuffers.length} individual segments...`)
        for (let i = 0; i < result.segmentBuffers.length; i++) {
          const segmentFileName = `podcasts/${safeTitle}-${timestamp}-seg${i.toString().padStart(3, '0')}.mp3`
          const segmentBlob = await put(segmentFileName, result.segmentBuffers[i], {
            access: 'public',
            contentType: 'audio/mpeg',
          })
          segmentUrls.push(segmentBlob.url)
        }
      }

      const fileName = `podcasts/${safeTitle}-${timestamp}.mp3`
      const blob = await put(fileName, result.audioBuffer, {
        access: 'public',
        contentType: 'audio/mpeg',
      })

      return {
        success: true,
        audioUrl: blob.url,
        segmentUrls: segmentUrls.length > 0 ? segmentUrls : undefined,
        segmentMetadata: result.segmentMetadata,
        durationSeconds: result.durationSeconds,
        lineCount: lines.length,
        warnings: warnings.length > 0 ? warnings : undefined,
        debug: result.debug,
      }
    }

    if (stream) {
      const encoder = new TextEncoder()
      const sseStream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            try {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
            } catch { /* stream closed */ }
          }
          const heartbeat = setInterval(() => {
            try { controller.enqueue(encoder.encode(': keepalive\n\n')) } catch { /* closed */ }
          }, 15000)
          try {
            const outcome = await finalize((event) => send('progress', event))
            if ('error' in outcome) {
              send('error', outcome)
            } else {
              send('done', outcome)
            }
          } catch (err) {
            send('error', { error: err instanceof Error ? err.message : 'Unknown error' })
          } finally {
            clearInterval(heartbeat)
            controller.close()
          }
        },
      })
      return new Response(sseStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
          'Connection': 'keep-alive',
        },
      })
    }

    const outcome = await finalize()
    if ('error' in outcome) {
      return NextResponse.json({ error: outcome.error }, { status: 500 })
    }
    return NextResponse.json(outcome)
  } catch (error) {
    console.error('[Podcast] Generation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/podcast/generate
 * Get information about the podcast generation endpoint
 */
export async function GET() {
  return NextResponse.json({
    deployedAt: '2025-02-05T15:00:00Z',
    endpoint: '/api/podcast/generate',
    method: 'POST',
    description: 'Generate a podcast audio from a dialogue script',
    requestBody: {
      script: 'string | PodcastLine[] - Raw text or parsed lines (required)',
      hostVoiceId: 'string - Override host voice ID (optional)',
      guestVoiceId: 'string - Override guest voice ID (optional)',
      title: 'string - Podcast title for filename (optional)',
      openaiModel: 'OpenAIModel - gpt-4o-mini-tts (default), tts-1, or tts-1-hd (optional)',
    },
    scriptFormat: {
      rawText: 'HOST: [voice direction] text\\nGUEST: [voice direction] text',
      structured: '[{ speaker: "HOST" | "GUEST", text: "..." }]',
    },
    example: {
      script: `HOST: [cheerful and warm, faster pacing] Good morning! Welcome to today's market analysis.
GUEST: [thoughtful, measured pace] Thanks! We have some interesting developments to discuss.
HOST: [curious, engaged] Let's start with the biggest story - what caught your attention?
GUEST: [excited, energetic] Well, the Fed announcement really moved markets yesterday.`,
      title: 'market-analysis-2024-02-05',
    },
  })
}
