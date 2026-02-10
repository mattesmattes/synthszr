import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { getTTSSettings, generatePreviewAudio, TTSVoice, TTSModel, TTSProvider } from '@/lib/tts/openai-tts'
import type { ElevenLabsModel } from '@/lib/tts/elevenlabs-tts'

/**
 * GET /api/admin/tts-settings
 * Fetch current TTS settings
 */
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const settings = await getTTSSettings()
    return NextResponse.json(settings)
  } catch (error) {
    console.error('[TTS Settings] Fetch error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

interface UpdateSettingsRequest {
  tts_provider?: TTSProvider
  tts_news_voice_de?: TTSVoice
  tts_news_voice_en?: TTSVoice
  tts_synthszr_voice_de?: TTSVoice
  tts_synthszr_voice_en?: TTSVoice
  tts_model?: TTSModel
  tts_enabled?: boolean
  // ElevenLabs settings
  elevenlabs_news_voice_en?: string
  elevenlabs_synthszr_voice_en?: string
  elevenlabs_model?: ElevenLabsModel
  // Podcast settings - legacy (backwards compatible)
  podcast_host_voice_id?: string
  podcast_guest_voice_id?: string
  // Podcast settings - German voices
  podcast_host_voice_de?: string
  podcast_guest_voice_de?: string
  // Podcast settings - English voices
  podcast_host_voice_en?: string
  podcast_guest_voice_en?: string
  podcast_duration_minutes?: number
  // Podcast script prompt
  podcast_script_prompt?: string
  // Mixing settings (JSON string)
  mixing_settings?: string
}

const VALID_VOICES: TTSVoice[] = ['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer']
const VALID_MODELS: TTSModel[] = ['tts-1', 'tts-1-hd']
const VALID_PROVIDERS: TTSProvider[] = ['openai', 'elevenlabs']
const VALID_ELEVENLABS_MODELS: ElevenLabsModel[] = ['eleven_v3', 'eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_turbo_v2']

/**
 * PUT /api/admin/tts-settings
 * Update TTS settings
 */
export async function PUT(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const body: UpdateSettingsRequest = await request.json()
    const supabase = await createClient()

    // Validate and update each setting
    const updates: Array<{ key: string; value: unknown }> = []

    if (body.tts_news_voice_de !== undefined) {
      if (!VALID_VOICES.includes(body.tts_news_voice_de)) {
        return NextResponse.json({ error: 'Invalid voice for tts_news_voice_de' }, { status: 400 })
      }
      updates.push({ key: 'tts_news_voice_de', value: body.tts_news_voice_de })
    }

    if (body.tts_news_voice_en !== undefined) {
      if (!VALID_VOICES.includes(body.tts_news_voice_en)) {
        return NextResponse.json({ error: 'Invalid voice for tts_news_voice_en' }, { status: 400 })
      }
      updates.push({ key: 'tts_news_voice_en', value: body.tts_news_voice_en })
    }

    if (body.tts_synthszr_voice_de !== undefined) {
      if (!VALID_VOICES.includes(body.tts_synthszr_voice_de)) {
        return NextResponse.json({ error: 'Invalid voice for tts_synthszr_voice_de' }, { status: 400 })
      }
      updates.push({ key: 'tts_synthszr_voice_de', value: body.tts_synthszr_voice_de })
    }

    if (body.tts_synthszr_voice_en !== undefined) {
      if (!VALID_VOICES.includes(body.tts_synthszr_voice_en)) {
        return NextResponse.json({ error: 'Invalid voice for tts_synthszr_voice_en' }, { status: 400 })
      }
      updates.push({ key: 'tts_synthszr_voice_en', value: body.tts_synthszr_voice_en })
    }

    if (body.tts_model !== undefined) {
      if (!VALID_MODELS.includes(body.tts_model)) {
        return NextResponse.json({ error: 'Invalid TTS model' }, { status: 400 })
      }
      updates.push({ key: 'tts_model', value: body.tts_model })
    }

    if (body.tts_enabled !== undefined) {
      updates.push({ key: 'tts_enabled', value: body.tts_enabled })
    }

    // Provider setting
    if (body.tts_provider !== undefined) {
      if (!VALID_PROVIDERS.includes(body.tts_provider)) {
        return NextResponse.json({ error: 'Invalid TTS provider' }, { status: 400 })
      }
      updates.push({ key: 'tts_provider', value: body.tts_provider })
    }

    // ElevenLabs settings (voice IDs are arbitrary strings)
    if (body.elevenlabs_news_voice_en !== undefined) {
      updates.push({ key: 'elevenlabs_news_voice_en', value: body.elevenlabs_news_voice_en })
    }

    if (body.elevenlabs_synthszr_voice_en !== undefined) {
      updates.push({ key: 'elevenlabs_synthszr_voice_en', value: body.elevenlabs_synthszr_voice_en })
    }

    if (body.elevenlabs_model !== undefined) {
      if (!VALID_ELEVENLABS_MODELS.includes(body.elevenlabs_model)) {
        return NextResponse.json({ error: 'Invalid ElevenLabs model' }, { status: 400 })
      }
      updates.push({ key: 'elevenlabs_model', value: body.elevenlabs_model })
    }

    // Podcast settings (voice IDs are arbitrary ElevenLabs voice IDs)
    // Legacy fields (backwards compatible)
    if (body.podcast_host_voice_id !== undefined) {
      updates.push({ key: 'podcast_host_voice_id', value: body.podcast_host_voice_id })
    }

    if (body.podcast_guest_voice_id !== undefined) {
      updates.push({ key: 'podcast_guest_voice_id', value: body.podcast_guest_voice_id })
    }

    // German podcast voices
    if (body.podcast_host_voice_de !== undefined) {
      updates.push({ key: 'podcast_host_voice_de', value: body.podcast_host_voice_de })
    }

    if (body.podcast_guest_voice_de !== undefined) {
      updates.push({ key: 'podcast_guest_voice_de', value: body.podcast_guest_voice_de })
    }

    // English podcast voices
    if (body.podcast_host_voice_en !== undefined) {
      updates.push({ key: 'podcast_host_voice_en', value: body.podcast_host_voice_en })
    }

    if (body.podcast_guest_voice_en !== undefined) {
      updates.push({ key: 'podcast_guest_voice_en', value: body.podcast_guest_voice_en })
    }

    if (body.podcast_duration_minutes !== undefined) {
      const duration = body.podcast_duration_minutes
      if (duration < 5 || duration > 30) {
        return NextResponse.json({ error: 'Podcast duration must be between 5 and 30 minutes' }, { status: 400 })
      }
      updates.push({ key: 'podcast_duration_minutes', value: duration })
    }

    // Podcast script prompt (can be any string)
    if (body.podcast_script_prompt !== undefined) {
      updates.push({ key: 'podcast_script_prompt', value: body.podcast_script_prompt })
    }

    // Mixing settings (stored as JSON string)
    if (body.mixing_settings !== undefined) {
      updates.push({ key: 'mixing_settings', value: body.mixing_settings })
    }

    // Apply updates
    for (const update of updates) {
      const { error } = await supabase
        .from('settings')
        .upsert({
          key: update.key,
          value: update.value,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' })

      if (error) {
        console.error(`[TTS Settings] Failed to update ${update.key}:`, error)
        return NextResponse.json(
          { error: `Failed to update ${update.key}` },
          { status: 500 }
        )
      }
    }

    // Return updated settings
    const settings = await getTTSSettings()
    return NextResponse.json(settings)
  } catch (error) {
    console.error('[TTS Settings] Update error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

interface PreviewRequest {
  text: string
  voice: TTSVoice
  model?: TTSModel
}

/**
 * POST /api/admin/tts-settings
 * Generate preview audio for a voice
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const body: PreviewRequest = await request.json()
    const { text, voice, model = 'tts-1' } = body

    if (!text || text.length > 500) {
      return NextResponse.json(
        { error: 'Text must be 1-500 characters' },
        { status: 400 }
      )
    }

    if (!VALID_VOICES.includes(voice)) {
      return NextResponse.json({ error: 'Invalid voice' }, { status: 400 })
    }

    if (!VALID_MODELS.includes(model)) {
      return NextResponse.json({ error: 'Invalid model' }, { status: 400 })
    }

    const result = await generatePreviewAudio(text, voice, model)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Preview generation failed' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      audioBase64: result.audioBase64,
      contentType: 'audio/mpeg',
    })
  } catch (error) {
    console.error('[TTS Settings] Preview error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
