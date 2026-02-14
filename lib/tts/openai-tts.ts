/**
 * OpenAI TTS Module
 * Generates speech from blog post content with dual voices:
 * - Female voice for news content
 * - Male voice for Synthszr Take sections
 */

import OpenAI from 'openai'
import { put } from '@vercel/blob'
import { createClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'
import { generateSpeechElevenLabs, type ElevenLabsModel } from './elevenlabs-tts'

// OpenAI TTS voices
export type TTSVoice = 'alloy' | 'echo' | 'fable' | 'nova' | 'onyx' | 'shimmer'
export type TTSModel = 'tts-1' | 'tts-1-hd'
export type TTSProvider = 'openai' | 'elevenlabs'

export interface TTSSettings {
  tts_provider: TTSProvider
  tts_news_voice_de: TTSVoice
  tts_news_voice_en: TTSVoice
  tts_synthszr_voice_de: TTSVoice
  tts_synthszr_voice_en: TTSVoice
  tts_model: TTSModel
  tts_enabled: boolean
  // ElevenLabs settings
  elevenlabs_news_voice_en: string
  elevenlabs_synthszr_voice_en: string
  elevenlabs_model: string
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

export interface ContentSection {
  type: 'news' | 'synthszr_take'
  text: string
}

export interface TiptapNode {
  type: string
  content?: TiptapNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, string> }>
  attrs?: Record<string, string | number>
}

export interface TiptapDoc {
  type: string
  content?: TiptapNode[]
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/**
 * Generate speech from text using OpenAI TTS API
 */
export async function generateSpeech(
  text: string,
  voice: TTSVoice,
  model: TTSModel = 'tts-1'
): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model,
    voice,
    input: text,
    response_format: 'mp3',
  })

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Extract plain text from a TipTap node recursively
 */
function extractTextFromNode(node: TiptapNode): string {
  if (node.type === 'text' && node.text) {
    return node.text
  }
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromNode).join('')
  }
  return ''
}

/**
 * Check if a node contains "Synthszr Take:" text
 */
function isSynthszrTakeNode(node: TiptapNode): boolean {
  const text = extractTextFromNode(node).toLowerCase()
  return text.includes('synthszr take')
}

/**
 * Clean text for TTS output
 * - Remove URLs
 * - Strip {Company} tags
 * - Replace "Synthszr" with "Synthesizer" for pronunciation
 * - Replace "→ source" with "Source: source" + 3sec pause
 * - Normalize whitespace
 */
function cleanTextForTTS(text: string): string {
  return text
    .replace(/https?:\/\/[^\s]+/g, '') // Remove URLs
    .replace(/\{([^}]+)\}/g, '$1') // Strip {Company} tags, keep company name
    .replace(/Synthszr/gi, 'Synthesizer') // Pronounce as "Synthesizer"
    .replace(/→\s*([^\n.]+)/g, 'Source: $1. ... ... ...') // "→ source" becomes "Source: source" + 3sec pause
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
}

/** Intro greeting for the audio */
const INTRO_TEXT = "Goooood morning! Here is your daily news synthesis to start your day."

/**
 * Split TipTap content into news and Synthszr Take sections
 * Returns sections in order they appear in the document
 */
export function splitContentBySections(content: TiptapDoc | string): ContentSection[] {
  const sections: ContentSection[] = []

  // Handle string content (may be stored as JSON string in DB)
  let doc: TiptapDoc
  if (typeof content === 'string') {
    try {
      doc = JSON.parse(content) as TiptapDoc
    } catch {
      console.error('[TTS] Failed to parse content as JSON')
      return sections
    }
  } else {
    doc = content
  }

  if (!doc.content || !Array.isArray(doc.content)) {
    return sections
  }

  let currentNewsText: string[] = []

  const flushNewsSection = () => {
    if (currentNewsText.length > 0) {
      const text = cleanTextForTTS(currentNewsText.join('\n\n'))
      if (text.trim()) {
        sections.push({ type: 'news', text })
      }
      currentNewsText = []
    }
  }

  for (const node of doc.content) {
    const nodeText = extractTextFromNode(node)

    // Check if this is a paragraph with Synthszr Take
    if (node.type === 'paragraph' && isSynthszrTakeNode(node)) {
      // Flush any accumulated news content
      flushNewsSection()

      // Add Synthszr Take section
      const cleanedText = cleanTextForTTS(nodeText)
      if (cleanedText.trim()) {
        sections.push({ type: 'synthszr_take', text: cleanedText })
      }
    } else if (node.type === 'heading') {
      // Check if heading is "Synthszr Take" or "Mattes Synthese" - skip these
      const headingText = nodeText.toLowerCase()
      if (headingText.includes('synthszr take') ||
          headingText.includes('mattes synthese') ||
          headingText.includes("mattes' synthese")) {
        // Skip editorial headings
        continue
      }
      // Add heading to news section with pauses before and after
      // The "..." creates a natural pause in OpenAI TTS
      const cleanedText = cleanTextForTTS(nodeText)
      if (cleanedText.trim()) {
        currentNewsText.push('...')  // Pause before heading
        currentNewsText.push(cleanedText)
        currentNewsText.push('...')  // Pause after heading
      }
    } else if (node.type === 'paragraph' || node.type === 'bulletList' || node.type === 'orderedList') {
      // Regular content goes to news section
      const cleanedText = cleanTextForTTS(nodeText)
      if (cleanedText.trim()) {
        currentNewsText.push(cleanedText)
      }
    }
    // Skip other node types (horizontal rules, empty nodes, etc.)
  }

  // Flush any remaining news content
  flushNewsSection()

  return sections
}

/**
 * Generate a content hash for cache invalidation
 */
export function generateContentHash(content: TiptapDoc | string): string {
  const sections = splitContentBySections(content)
  const text = sections.map(s => s.text).join('|')
  return createHash('md5').update(text).digest('hex')
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
      'tts_provider',
      'tts_news_voice_de',
      'tts_news_voice_en',
      'tts_synthszr_voice_de',
      'tts_synthszr_voice_en',
      'tts_model',
      'tts_enabled',
      'elevenlabs_news_voice_en',
      'elevenlabs_synthszr_voice_en',
      'elevenlabs_model',
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
    tts_provider: (settingsMap.tts_provider as TTSProvider) || 'openai',
    tts_news_voice_de: (settingsMap.tts_news_voice_de as TTSVoice) || 'nova',
    tts_news_voice_en: (settingsMap.tts_news_voice_en as TTSVoice) || 'nova',
    tts_synthszr_voice_de: (settingsMap.tts_synthszr_voice_de as TTSVoice) || 'onyx',
    tts_synthszr_voice_en: (settingsMap.tts_synthszr_voice_en as TTSVoice) || 'onyx',
    tts_model: (settingsMap.tts_model as TTSModel) || 'tts-1',
    tts_enabled: settingsMap.tts_enabled !== false, // Default to true
    // ElevenLabs defaults - Lily for news, Daniel for Synthszr Take
    elevenlabs_news_voice_en: (settingsMap.elevenlabs_news_voice_en as string) || 'pFZP5JQG7iQjIQuC4Bku', // Lily
    elevenlabs_synthszr_voice_en: (settingsMap.elevenlabs_synthszr_voice_en as string) || 'onwK4e9ZLuTAKqWW03F9', // Daniel
    elevenlabs_model: (settingsMap.elevenlabs_model as string) || 'eleven_v3',
    // Podcast legacy (backwards compatible)
    podcast_host_voice_id: (settingsMap.podcast_host_voice_id as string) || 'pFZP5JQG7iQjIQuC4Bku', // Lily
    podcast_guest_voice_id: (settingsMap.podcast_guest_voice_id as string) || 'onwK4e9ZLuTAKqWW03F9', // Daniel
    // Podcast German voices - Matilda as host, Ethan as guest
    podcast_host_voice_de: (settingsMap.podcast_host_voice_de as string) || 'XrExE9yKIg1WjnnlVkGX', // Matilda
    podcast_guest_voice_de: (settingsMap.podcast_guest_voice_de as string) || 'g5CIjZEefAph4nQFvHAz', // Ethan
    // Podcast English voices - Lily as host, Daniel as guest
    podcast_host_voice_en: (settingsMap.podcast_host_voice_en as string) || 'pFZP5JQG7iQjIQuC4Bku', // Lily
    podcast_guest_voice_en: (settingsMap.podcast_guest_voice_en as string) || 'onwK4e9ZLuTAKqWW03F9', // Daniel
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
 * Concatenate multiple audio buffers (MP3)
 * Simple concatenation works for MP3 files
 */
function concatenateAudioBuffers(buffers: Buffer[]): Buffer {
  return Buffer.concat(buffers)
}

/**
 * Generate complete audio for a blog post
 * Processes content, generates audio for each section with appropriate voice,
 * concatenates, and uploads to Vercel Blob
 */
export async function generatePostAudio(
  postId: string,
  content: TiptapDoc,
  locale: 'de' | 'en'
): Promise<{ success: boolean; audioUrl?: string; error?: string; duration?: number }> {
  const supabase = await createClient()

  try {
    // Get TTS settings
    const settings = await getTTSSettings()

    if (!settings.tts_enabled) {
      return { success: false, error: 'TTS is disabled' }
    }

    // Split content into sections
    const sections = splitContentBySections(content)

    if (sections.length === 0) {
      return { success: false, error: 'No content to convert to speech' }
    }

    // Generate content hash for caching
    const contentHash = generateContentHash(content)

    // Check if we already have audio for this exact content
    const { data: existingAudio } = await supabase
      .from('post_audio')
      .select('audio_url, content_hash')
      .eq('post_id', postId)
      .eq('locale', locale)
      .eq('generation_status', 'completed')
      .single()

    if (existingAudio && existingAudio.content_hash === contentHash) {
      return { success: true, audioUrl: existingAudio.audio_url }
    }

    // Create or update pending record
    // Track which provider and voices are being used
    const isElevenLabs = settings.tts_provider === 'elevenlabs'
    const { data: audioRecord, error: upsertError } = await supabase
      .from('post_audio')
      .upsert({
        post_id: postId,
        locale,
        audio_url: '',
        generation_status: 'generating',
        content_hash: contentHash,
        news_voice: isElevenLabs ? settings.elevenlabs_news_voice_en : settings.tts_news_voice_en,
        synthszr_voice: isElevenLabs ? settings.elevenlabs_synthszr_voice_en : settings.tts_synthszr_voice_en,
        model: isElevenLabs ? settings.elevenlabs_model : settings.tts_model,
      }, {
        onConflict: 'post_id,locale',
      })
      .select()
      .single()

    if (upsertError) {
      console.error('[TTS] Failed to create audio record:', upsertError)
      return { success: false, error: 'Failed to create audio record' }
    }

    // Generate audio for each section
    const audioBuffers: Buffer[] = []

    // Helper function to generate speech with selected provider
    const generateAudio = async (text: string, isEditorial: boolean): Promise<Buffer> => {
      if (isElevenLabs) {
        const voiceId = isEditorial
          ? settings.elevenlabs_synthszr_voice_en
          : settings.elevenlabs_news_voice_en
        return generateSpeechElevenLabs(text, voiceId, settings.elevenlabs_model as ElevenLabsModel)
      } else {
        // OpenAI - always use English voices
        const voice = isEditorial
          ? settings.tts_synthszr_voice_en
          : settings.tts_news_voice_en
        return generateSpeech(text, voice, settings.tts_model)
      }
    }

    // Generate intro greeting first
    try {
      const providerName = isElevenLabs ? 'ElevenLabs' : 'OpenAI'
      console.log(`[TTS] Generating intro with ${providerName}`)
      const introBuffer = await generateAudio(INTRO_TEXT, false)
      audioBuffers.push(introBuffer)
    } catch (error) {
      console.error(`[TTS] Failed to generate intro: ${error}`)
      // Continue without intro if it fails
    }

    for (const section of sections) {
      const isEditorial = section.type === 'synthszr_take'

      try {
        const providerName = isElevenLabs ? 'ElevenLabs' : 'OpenAI'
        console.log(`[TTS] Generating ${section.type} section (${section.text.length} chars) with ${providerName}`)
        const audioBuffer = await generateAudio(section.text, isEditorial)
        audioBuffers.push(audioBuffer)
      } catch (error) {
        console.error(`[TTS] Failed to generate section: ${error}`)
        throw error
      }
    }

    // Concatenate all audio buffers
    const combinedAudio = concatenateAudioBuffers(audioBuffers)

    // Calculate approximate duration (MP3 at ~128kbps)
    const approximateDuration = Math.round(combinedAudio.length / (128 * 1024 / 8))

    // Upload to Vercel Blob
    const fileName = `post-audio/${postId}/${locale}.mp3`

    let blobUrl: string
    try {
      const blob = await put(fileName, combinedAudio, {
        access: 'public',
        contentType: 'audio/mpeg',
        allowOverwrite: true,  // Allow regeneration with updated content
      })
      blobUrl = blob.url
    } catch (uploadError) {
      console.error('[TTS] Failed to upload audio:', uploadError)
      await supabase
        .from('post_audio')
        .update({
          generation_status: 'failed',
          error_message: 'Failed to upload audio to storage',
        })
        .eq('id', audioRecord.id)
      return { success: false, error: 'Failed to upload audio' }
    }

    // Update record with success
    const { error: updateError } = await supabase
      .from('post_audio')
      .update({
        audio_url: blobUrl,
        generation_status: 'completed',
        duration_seconds: approximateDuration,
        file_size_bytes: combinedAudio.length,
        error_message: null,
      })
      .eq('id', audioRecord.id)

    if (updateError) {
      console.error('[TTS] Failed to update audio record:', updateError)
    }

    console.log(`[TTS] Successfully generated audio for post ${postId} (${locale}): ${blobUrl}`)

    return {
      success: true,
      audioUrl: blobUrl,
      duration: approximateDuration
    }
  } catch (error) {
    console.error('[TTS] Generation error:', error)

    // Update record with error
    await supabase
      .from('post_audio')
      .update({
        generation_status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('post_id', postId)
      .eq('locale', locale)

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Get existing audio URL for a post (if available)
 */
export async function getPostAudioUrl(
  postId: string,
  locale: 'de' | 'en'
): Promise<{ audioUrl: string | null; status: string; duration?: number }> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('post_audio')
    .select('audio_url, generation_status, duration_seconds')
    .eq('post_id', postId)
    .eq('locale', locale)
    .single()

  if (!data) {
    return { audioUrl: null, status: 'not_found' }
  }

  return {
    audioUrl: data.generation_status === 'completed' ? data.audio_url : null,
    status: data.generation_status,
    duration: data.duration_seconds ?? undefined,
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
