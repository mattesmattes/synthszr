/**
 * Analogy Audio Generator
 *
 * Generates TTS audio for analogy text.
 * Uses OpenAI TTS (already integrated), ElevenLabs-ready for later.
 */

import { put } from '@vercel/blob'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateSpeech, type TTSVoice, type TTSModel } from '@/lib/tts/openai-tts'

interface AnalogyAudioSettings {
  provider: 'openai' | 'elevenlabs'
  voice: TTSVoice
  model: TTSModel
  instructions: string
}

const DEFAULT_SETTINGS: AnalogyAudioSettings = {
  provider: 'openai',
  voice: 'onyx',
  model: 'gpt-4o-mini-tts',
  instructions: 'Speak slowly and deliberately, with gravitas. No filler words. Measured pace, confident tone.',
}

/**
 * Get TTS settings for analogy audio from DB
 */
async function getAudioSettings(): Promise<AnalogyAudioSettings> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'analogy_audio_settings')
      .single()

    if (data?.value) {
      return { ...DEFAULT_SETTINGS, ...data.value }
    }
  } catch {
    // Use defaults
  }
  return DEFAULT_SETTINGS
}

interface AudioResult {
  success: boolean
  audioBuffer?: Buffer
  durationSeconds?: number
  error?: string
}

/**
 * Generate TTS audio for an analogy text.
 */
export async function generateAnalogyAudio(analogyText: string): Promise<AudioResult> {
  const settings = await getAudioSettings()

  if (settings.provider === 'openai') {
    return generateOpenAIAudio(analogyText, settings)
  }

  // ElevenLabs placeholder for future implementation
  return { success: false, error: `Provider '${settings.provider}' not yet implemented` }
}

async function generateOpenAIAudio(
  text: string,
  settings: AnalogyAudioSettings
): Promise<AudioResult> {
  try {
    console.log(`[AnalogyAudio] Generating with OpenAI ${settings.model}, voice: ${settings.voice}`)

    // For gpt-4o-mini-tts, prepend speaking instructions
    let inputText = text
    if (settings.model === 'gpt-4o-mini-tts' && settings.instructions) {
      inputText = `[${settings.instructions}]\n\n${text}`
    }

    const audioBuffer = await generateSpeech(inputText, settings.voice, settings.model)

    // Estimate duration from MP3 buffer size (~128kbps)
    const durationSeconds = audioBuffer.length / (128 * 1024 / 8)

    console.log(`[AnalogyAudio] Generated ${audioBuffer.length} bytes, ~${durationSeconds.toFixed(1)}s`)

    return {
      success: true,
      audioBuffer,
      durationSeconds,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[AnalogyAudio] Generation failed:', message)
    return { success: false, error: message }
  }
}

/**
 * Upload audio buffer to Vercel Blob.
 */
export async function uploadAnalogyAudio(
  videoId: string,
  audioBuffer: Buffer
): Promise<string> {
  const fileName = `analogy-videos/${videoId}/audio.mp3`

  const blob = await put(fileName, audioBuffer, {
    access: 'public',
    contentType: 'audio/mpeg',
    allowOverwrite: true,
  })

  return blob.url
}
