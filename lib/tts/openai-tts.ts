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

// OpenAI TTS voices
export type TTSVoice = 'alloy' | 'echo' | 'fable' | 'nova' | 'onyx' | 'shimmer'
export type TTSModel = 'tts-1' | 'tts-1-hd'

export interface TTSSettings {
  tts_news_voice_de: TTSVoice
  tts_news_voice_en: TTSVoice
  tts_synthszr_voice_de: TTSVoice
  tts_synthszr_voice_en: TTSVoice
  tts_model: TTSModel
  tts_enabled: boolean
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
      'tts_news_voice_de',
      'tts_news_voice_en',
      'tts_synthszr_voice_de',
      'tts_synthszr_voice_en',
      'tts_model',
      'tts_enabled'
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
    tts_model: (settingsMap.tts_model as TTSModel) || 'tts-1',
    tts_enabled: settingsMap.tts_enabled !== false, // Default to true
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
    // Always use English voices (German TTS quality is poor)
    const { data: audioRecord, error: upsertError } = await supabase
      .from('post_audio')
      .upsert({
        post_id: postId,
        locale,
        audio_url: '',
        generation_status: 'generating',
        content_hash: contentHash,
        news_voice: settings.tts_news_voice_en,
        synthszr_voice: settings.tts_synthszr_voice_en,
        model: settings.tts_model,
      }, {
        onConflict: 'post_id,locale',
      })
      .select()
      .single()

    if (upsertError) {
      console.error('[TTS] Failed to create audio record:', upsertError)
      return { success: false, error: 'Failed to create audio record' }
    }

    // Always use English voices (German TTS quality is poor)
    const newsVoice = settings.tts_news_voice_en
    const synthszrVoice = settings.tts_synthszr_voice_en

    // Generate audio for each section
    const audioBuffers: Buffer[] = []

    // Generate intro greeting first
    try {
      console.log(`[TTS] Generating intro with voice ${newsVoice}`)
      const introBuffer = await generateSpeech(INTRO_TEXT, newsVoice, settings.tts_model)
      audioBuffers.push(introBuffer)
    } catch (error) {
      console.error(`[TTS] Failed to generate intro: ${error}`)
      // Continue without intro if it fails
    }

    for (const section of sections) {
      const voice = section.type === 'synthszr_take' ? synthszrVoice : newsVoice

      try {
        console.log(`[TTS] Generating ${section.type} section (${section.text.length} chars) with voice ${voice}`)
        const audioBuffer = await generateSpeech(section.text, voice, settings.tts_model)
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
