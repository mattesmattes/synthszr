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
  type ElevenLabsModel,
} from '@/lib/tts/elevenlabs-tts'

interface GeneratePodcastRequest {
  script: string | PodcastLine[]
  hostVoiceId?: string
  guestVoiceId?: string
  title?: string
  model?: ElevenLabsModel
}

export async function POST(request: NextRequest) {
  // Auth check - only admin can generate podcasts
  const authError = await requireAdmin(request)
  if (authError) return authError

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
    const model = body.model || (settings.elevenlabs_model as ElevenLabsModel)

    // Estimate duration before generation
    const estimatedDuration = estimatePodcastDuration(lines)
    console.log(`[Podcast] Generating podcast with ${lines.length} lines, estimated ${estimatedDuration}s`)
    console.log(`[Podcast] Using model: ${model}, host: ${hostVoiceId}, guest: ${guestVoiceId}`)

    // Generate the podcast audio
    const result = await generatePodcastDialogue({
      lines,
      hostVoiceId,
      guestVoiceId,
      model,
    })

    if (!result.success || !result.audioBuffer) {
      return NextResponse.json(
        { error: result.error || 'Failed to generate podcast audio' },
        { status: 500 }
      )
    }

    // Generate unique filename
    const timestamp = Date.now()
    const safeTitle = (body.title || 'podcast')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50)
    const fileName = `podcasts/${safeTitle}-${timestamp}.mp3`

    // Upload to Vercel Blob
    const blob = await put(fileName, result.audioBuffer, {
      access: 'public',
      contentType: 'audio/mpeg',
    })

    console.log(`[Podcast] Uploaded to ${blob.url} (${result.durationSeconds}s)`)

    return NextResponse.json({
      success: true,
      audioUrl: blob.url,
      durationSeconds: result.durationSeconds,
      lineCount: lines.length,
      warnings: warnings.length > 0 ? warnings : undefined,
      debug: result.debug,
    })
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
      model: 'ElevenLabsModel - TTS model to use (optional)',
    },
    scriptFormat: {
      rawText: 'HOST: [emotion] text\\nGUEST: [emotion] text',
      structured: '[{ speaker: "HOST" | "GUEST", text: "..." }]',
    },
    supportedEmotions: [
      'cheerfully', 'thoughtfully', 'seriously', 'excitedly',
      'skeptically', 'laughing', 'sighing', 'whispering',
      'interrupting', 'curiously', 'dramatically', 'calmly',
      'enthusiastically',
    ],
    example: {
      script: `HOST: [cheerfully] Good morning! Welcome to today's market analysis.
GUEST: [thoughtfully] Thanks! We have some interesting developments to discuss.
HOST: [curiously] Let's start with the biggest story - what caught your attention?
GUEST: [excitedly] Well, the Fed announcement really moved markets yesterday.`,
      title: 'market-analysis-2024-02-05',
    },
  })
}
