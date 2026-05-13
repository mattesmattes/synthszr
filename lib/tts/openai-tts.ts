/**
 * OpenAI TTS settings + low-level speech generation.
 *
 * Scope (after the May 2026 cleanup): this module owns the shared TTS
 * settings shape, the silent-take-safe generateSpeech primitive, and
 * the settings-page voice preview. The podcast pipeline calls OpenAI
 * directly inside its own job worker; the legacy per-article
 * post_audio feature has been retired.
 */

import OpenAI from 'openai'
import { createClient } from '@/lib/supabase/server'

// OpenAI TTS voices
export type TTSVoice = 'alloy' | 'ash' | 'coral' | 'echo' | 'fable' | 'nova' | 'onyx' | 'sage' | 'shimmer'
export type TTSModel = 'tts-1' | 'tts-1-hd' | 'gpt-4o-mini-tts'

export interface TTSSettings {
  tts_news_voice_de: TTSVoice
  tts_news_voice_en: TTSVoice
  tts_synthszr_voice_de: TTSVoice
  tts_synthszr_voice_en: TTSVoice
  tts_model: TTSModel
  tts_enabled: boolean
  // Podcast settings - legacy (backwards compatible)
  podcast_host_voice_id: string
  podcast_guest_voice_id: string
  // Podcast settings - German voices
  podcast_host_voice_de: string
  podcast_guest_voice_de: string
  // Podcast settings - English voices (used for EN, CS, NDS, etc.)
  podcast_host_voice_en: string
  podcast_guest_voice_en: string
  podcast_duration_minutes: number
  // Podcast script prompt
  podcast_script_prompt: string | null
  // Mixing settings (JSON blob)
  mixing_settings: MixingSettings | null
}

export interface MixingSettings {
  intro_enabled: boolean
  intro_full_sec: number
  intro_bed_sec: number
  intro_bed_volume: number     // percentage 0-100
  intro_fadeout_sec: number
  intro_dialog_fadein_sec: number
  intro_fadeout_curve?: 'linear' | 'exponential'
  intro_dialog_curve?: 'linear' | 'exponential'
  outro_enabled: boolean
  outro_crossfade_sec: number
  outro_rise_sec: number
  outro_bed_volume: number     // percentage 0-100
  outro_final_start_sec: number
  outro_rise_curve?: 'linear' | 'exponential'
  outro_final_curve?: 'linear' | 'exponential'
  stereo_host: number          // 0-100 (0=left, 100=right)
  stereo_guest: number         // 0-100
  overlap_reaction_ms: number
  overlap_interrupt_ms: number
  overlap_question_ms: number
  overlap_speaker_ms: number
  overlap_overlapping_ms: number
  // Envelope-based mixing (takes precedence over parametric when present)
  intro_music_envelope?: import('@/lib/audio/envelope').AudioEnvelope
  intro_dialog_envelope?: import('@/lib/audio/envelope').AudioEnvelope
  outro_music_envelope?: import('@/lib/audio/envelope').AudioEnvelope
  outro_dialog_envelope?: import('@/lib/audio/envelope').AudioEnvelope
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/**
 * Generate speech from text using OpenAI TTS API.
 *
 * Silent-take mitigation: OpenAI occasionally returns a near-empty MP3
 * (a few hundred bytes) with HTTP 200 instead of throwing. Validate
 * the buffer length and retry on suspect-short results so silent
 * takes don't bake into downstream audio.
 */
export async function generateSpeech(
  text: string,
  voice: TTSVoice,
  model: TTSModel = 'tts-1'
): Promise<Buffer> {
  // ~70 bytes/sec MP3 → ein 1-Sek-Take ist ≥4 KB.
  // Alles unter 1 KB ist mit hoher Wahrscheinlichkeit ein leeres/abgebrochenes Result.
  const MIN_BYTES = 1024
  const MAX_ATTEMPTS = 3

  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await openai.audio.speech.create({
        model,
        voice,
        input: text,
        response_format: 'mp3',
      })
      const buf = Buffer.from(await response.arrayBuffer())
      if (buf.length >= MIN_BYTES) return buf

      console.warn('[TTS] Suspect empty/short audio, retrying', {
        attempt,
        bytes: buf.length,
        voice,
        textPreview: text.slice(0, 60),
      })
    } catch (err) {
      lastErr = err
      console.warn('[TTS] Speech.create threw, retrying', { attempt, err })
    }
    // Linear backoff: 500ms, 1000ms — fast genug, weil das Problem fast
    // immer transient ist (kein Rate-Limit-Pattern).
    await new Promise(r => setTimeout(r, attempt * 500))
  }
  throw lastErr ?? new Error(`TTS lieferte nach ${MAX_ATTEMPTS} Versuchen kein valides Audio (text: "${text.slice(0, 60)}…")`)
}

/**
 * Get TTS settings from database
 */
export async function getTTSSettings(): Promise<TTSSettings> {
  const supabase = await createClient()

  const { data: settings } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', [
      'tts_news_voice_de',
      'tts_news_voice_en',
      'tts_synthszr_voice_de',
      'tts_synthszr_voice_en',
      'tts_model',
      'tts_enabled',
      'podcast_host_voice_id',
      'podcast_guest_voice_id',
      'podcast_host_voice_de',
      'podcast_guest_voice_de',
      'podcast_host_voice_en',
      'podcast_guest_voice_en',
      'podcast_duration_minutes',
      'podcast_script_prompt',
      'mixing_settings',
    ])

  const settingsMap: Record<string, unknown> = {}
  if (settings) {
    for (const s of settings) {
      settingsMap[s.key] = s.value
    }
  }

  return {
    tts_news_voice_de: (settingsMap.tts_news_voice_de as TTSVoice) || 'nova',
    tts_news_voice_en: (settingsMap.tts_news_voice_en as TTSVoice) || 'nova',
    tts_synthszr_voice_de: (settingsMap.tts_synthszr_voice_de as TTSVoice) || 'onyx',
    tts_synthszr_voice_en: (settingsMap.tts_synthszr_voice_en as TTSVoice) || 'onyx',
    tts_model: (settingsMap.tts_model as TTSModel) || 'gpt-4o-mini-tts',
    tts_enabled: settingsMap.tts_enabled !== false, // Default to true
    // Podcast legacy (backwards compatible)
    podcast_host_voice_id: (settingsMap.podcast_host_voice_id as string) || 'nova',
    podcast_guest_voice_id: (settingsMap.podcast_guest_voice_id as string) || 'onyx',
    // Podcast German voices
    podcast_host_voice_de: (settingsMap.podcast_host_voice_de as string) || 'shimmer',
    podcast_guest_voice_de: (settingsMap.podcast_guest_voice_de as string) || 'fable',
    // Podcast English voices
    podcast_host_voice_en: (settingsMap.podcast_host_voice_en as string) || 'shimmer',
    podcast_guest_voice_en: (settingsMap.podcast_guest_voice_en as string) || 'fable',
    podcast_duration_minutes: (settingsMap.podcast_duration_minutes as number) || 30,
    // Podcast script prompt (null means use default)
    podcast_script_prompt: (settingsMap.podcast_script_prompt as string) || null,
    // Mixing settings (stored as JSON string)
    mixing_settings: settingsMap.mixing_settings
      ? (typeof settingsMap.mixing_settings === 'string'
        ? JSON.parse(settingsMap.mixing_settings)
        : settingsMap.mixing_settings as MixingSettings)
      : null,
  }
}

/**
 * Generate preview audio for a sample text (for settings page)
 */
export async function generatePreviewAudio(
  text: string,
  voice: TTSVoice,
  model: TTSModel = 'tts-1'
): Promise<{ success: boolean; audioBase64?: string; error?: string }> {
  try {
    const audioBuffer = await generateSpeech(text, voice, model)
    const audioBase64 = audioBuffer.toString('base64')

    return { success: true, audioBase64 }
  } catch (error) {
    console.error('[TTS] Preview generation error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
