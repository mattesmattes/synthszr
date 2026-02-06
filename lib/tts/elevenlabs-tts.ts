/**
 * ElevenLabs TTS Module
 * Alternative TTS provider with higher quality voices
 */

import { ElevenLabsClient } from 'elevenlabs'

// ElevenLabs voice IDs for recommended voices
// These are pre-selected voices good for news/podcast content
export const ELEVENLABS_VOICES = {
  // English voices
  en: {
    news: [
      { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Warm, professional female' },
      { id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', description: 'Energetic, youthful female' },
      { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Soft, friendly female' },
      { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Authoritative British male' },
      { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', description: 'Natural, conversational male' },
      { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', description: 'Deep, trustworthy male' },
    ],
    synthszr: [
      { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Authoritative British male' },
      { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', description: 'Deep, trustworthy male' },
      { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', description: 'Natural, conversational male' },
      { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Warm, professional female' },
    ],
  },
  // German voices
  de: {
    news: [
      { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', description: 'Warm, professional German female' },
      { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', description: 'Clear, articulate German female' },
      { id: 'g5CIjZEefAph4nQFvHAz', name: 'Ethan', description: 'Natural German male' },
    ],
    synthszr: [
      { id: 'g5CIjZEefAph4nQFvHAz', name: 'Ethan', description: 'Natural German male' },
      { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', description: 'Warm, professional German female' },
    ],
  },
}

// Model options - eleven_v3 supports audio tags like [cheerfully], [whispers], etc.
export type ElevenLabsModel = 'eleven_v3' | 'eleven_multilingual_v2' | 'eleven_turbo_v2_5' | 'eleven_turbo_v2'

let client: ElevenLabsClient | null = null

function getClient(): ElevenLabsClient {
  if (!client) {
    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
      throw new Error('ELEVENLABS_API_KEY environment variable is not set')
    }
    client = new ElevenLabsClient({ apiKey })
  }
  return client
}

/**
 * Generate speech using ElevenLabs API
 */
export async function generateSpeechElevenLabs(
  text: string,
  voiceId: string,
  model: ElevenLabsModel = 'eleven_multilingual_v2'
): Promise<Buffer> {
  const elevenLabs = getClient()

  const audioStream = await elevenLabs.textToSpeech.convert(voiceId, {
    text,
    model_id: model,
    output_format: 'mp3_44100_128',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
    },
  })

  // Convert stream to buffer
  const chunks: Uint8Array[] = []
  for await (const chunk of audioStream) {
    chunks.push(chunk)
  }

  return Buffer.concat(chunks)
}

/**
 * Get available voices from ElevenLabs (for admin UI)
 */
export async function getAvailableVoices(): Promise<Array<{ id: string; name: string; labels?: Record<string, string> }>> {
  try {
    const elevenLabs = getClient()
    const response = await elevenLabs.voices.getAll()

    return response.voices.map((voice) => ({
      id: voice.voice_id,
      name: voice.name || 'Unknown',
      labels: voice.labels,
    }))
  } catch (error) {
    console.error('[ElevenLabs] Failed to fetch voices:', error)
    // Return default voices if API fails
    return [
      ...ELEVENLABS_VOICES.en.news,
      ...ELEVENLABS_VOICES.de.news,
    ]
  }
}

/**
 * Get recommended voices for a locale and type
 */
export function getRecommendedVoices(
  locale: 'de' | 'en',
  type: 'news' | 'synthszr'
): Array<{ id: string; name: string; description: string }> {
  return ELEVENLABS_VOICES[locale]?.[type] || ELEVENLABS_VOICES.en[type]
}

// ============================================================================
// TEXT-TO-DIALOGUE (Podcast) API
// ============================================================================

/**
 * A single line of dialogue in a podcast script
 */
export interface PodcastLine {
  speaker: 'HOST' | 'GUEST'
  text: string // Can include emotion tags like [cheerfully], [thoughtfully]
}

/**
 * Complete podcast script structure
 */
export interface PodcastScript {
  lines: PodcastLine[]
  hostVoiceId: string
  guestVoiceId: string
  model?: ElevenLabsModel
}

/**
 * Result of podcast generation
 */
export interface PodcastGenerationResult {
  success: boolean
  audioBuffer?: Buffer
  durationSeconds?: number
  error?: string
}

/**
 * Emotion tags supported by ElevenLabs for natural dialogue
 * These can be placed at the start of text: "[cheerfully] Great news today!"
 */
export const EMOTION_TAGS = [
  'cheerfully',
  'thoughtfully',
  'seriously',
  'excitedly',
  'skeptically',
  'laughing',
  'sighing',
  'whispering',
  'interrupting',
  'curiously',
  'dramatically',
  'calmly',
  'enthusiastically',
] as const

export type EmotionTag = typeof EMOTION_TAGS[number]

/**
 * Generate a single dialogue segment with ElevenLabs
 * Includes voice settings optimized for conversational speech
 */
async function generateDialogueSegment(
  text: string,
  voiceId: string,
  model: ElevenLabsModel = 'eleven_v3' // v3 supports audio tags like [cheerfully]
): Promise<Buffer> {
  if (!text.trim()) {
    return Buffer.alloc(0)
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY environment variable is not set')
  }

  console.log(`[TTS] Request: model=${model}, voiceId=${voiceId}, textLength=${text.length}`)

  // Use direct fetch instead of SDK for eleven_v3 compatibility
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: model,
      output_format: 'mp3_44100_128',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Generate a short silence buffer (for natural pauses between speakers)
 * Creates a ~300ms pause using a minimal valid MP3 frame
 */
function generateSilenceBuffer(): Buffer {
  // Minimal valid MP3 silence frame (MPEG Audio Layer 3, 128kbps, 44.1kHz)
  // This creates approximately 300ms of silence
  const silenceFrames: number[] = []

  // MP3 frame header for 128kbps, 44.1kHz, stereo
  const frameHeader = [0xFF, 0xFB, 0x90, 0x00]
  const frameData = new Array(417 - 4).fill(0) // Frame size for 128kbps @ 44.1kHz

  // Add ~12 frames for ~300ms of silence
  for (let i = 0; i < 12; i++) {
    silenceFrames.push(...frameHeader, ...frameData)
  }

  return Buffer.from(silenceFrames)
}

/**
 * Find the start of MPEG audio data in an MP3 buffer, skipping ID3 tags
 */
function findMpegAudioStart(buffer: Buffer): number {
  let offset = 0

  // Check for ID3v2 header at the beginning
  if (buffer.length >= 10 &&
      buffer[0] === 0x49 && // 'I'
      buffer[1] === 0x44 && // 'D'
      buffer[2] === 0x33) { // '3'
    // ID3v2 tag found, calculate size
    // Size is stored in 4 bytes as syncsafe integers (7 bits per byte)
    const size = ((buffer[6] & 0x7F) << 21) |
                 ((buffer[7] & 0x7F) << 14) |
                 ((buffer[8] & 0x7F) << 7) |
                 (buffer[9] & 0x7F)
    offset = 10 + size
  }

  // Find first valid MPEG frame sync (0xFF followed by 0xE0-0xFF)
  while (offset < buffer.length - 1) {
    if (buffer[offset] === 0xFF && (buffer[offset + 1] & 0xE0) === 0xE0) {
      return offset
    }
    offset++
  }

  return 0 // Fallback to beginning
}

/**
 * Find the end of MPEG audio data, excluding ID3v1 tag if present
 */
function findMpegAudioEnd(buffer: Buffer): number {
  // ID3v1 tag is exactly 128 bytes at the end, starting with "TAG"
  if (buffer.length >= 128) {
    const tagStart = buffer.length - 128
    if (buffer[tagStart] === 0x54 && // 'T'
        buffer[tagStart + 1] === 0x41 && // 'A'
        buffer[tagStart + 2] === 0x47) { // 'G'
      return tagStart
    }
  }

  return buffer.length
}

/**
 * Extract raw MPEG audio frames from an MP3 buffer
 * Strips ID3v2 header and ID3v1 footer
 */
function extractMpegFrames(buffer: Buffer): Buffer {
  const start = findMpegAudioStart(buffer)
  const end = findMpegAudioEnd(buffer)

  if (start >= end || start >= buffer.length) {
    return buffer // Return as-is if we can't parse it
  }

  return buffer.subarray(start, end)
}

/**
 * Concatenate multiple MP3 buffers properly
 * Strips ID3 tags from subsequent files and combines raw MPEG audio frames
 */
function concatenateMp3Buffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) return Buffer.alloc(0)
  if (buffers.length === 1) return buffers[0]

  const extractedFrames: Buffer[] = []

  for (let i = 0; i < buffers.length; i++) {
    const buffer = buffers[i]
    if (!buffer || buffer.length === 0) continue

    // Extract MPEG frames, stripping ID3 tags
    const frames = extractMpegFrames(buffer)
    extractedFrames.push(frames)
  }

  return Buffer.concat(extractedFrames)
}

/**
 * Generate complete podcast audio from a script
 *
 * @param script - The podcast script with speaker assignments
 * @returns Audio buffer and metadata
 *
 * @example
 * const result = await generatePodcastDialogue({
 *   lines: [
 *     { speaker: 'HOST', text: '[cheerfully] Welcome to today\'s market analysis!' },
 *     { speaker: 'GUEST', text: '[thoughtfully] Thanks! Let\'s dive into the key stories.' },
 *   ],
 *   hostVoiceId: 'pFZP5JQG7iQjIQuC4Bku', // Lily
 *   guestVoiceId: 'onwK4e9ZLuTAKqWW03F9', // Daniel
 * })
 */
export async function generatePodcastDialogue(
  script: PodcastScript
): Promise<PodcastGenerationResult> {
  try {
    if (!script.lines || script.lines.length === 0) {
      return { success: false, error: 'Script has no dialogue lines' }
    }

    // Filter out empty lines first
    const validLines = script.lines.filter(line => line.text.trim())

    if (validLines.length === 0) {
      return { success: false, error: 'Script has no valid dialogue lines' }
    }

    const silenceBuffer = generateSilenceBuffer()
    const BATCH_SIZE = 5 // Generate 5 lines in parallel to avoid rate limiting

    console.log(`[Podcast] Generating ${validLines.length} lines in parallel batches of ${BATCH_SIZE}`)

    // Generate all audio segments in parallel batches
    const audioSegments: Buffer[] = new Array(validLines.length)

    for (let batchStart = 0; batchStart < validLines.length; batchStart += BATCH_SIZE) {
      const batch = validLines.slice(batchStart, batchStart + BATCH_SIZE)
      const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(validLines.length / BATCH_SIZE)

      console.log(`[Podcast] Batch ${batchNum}/${totalBatches}: generating lines ${batchStart + 1}-${batchStart + batch.length}`)

      const batchPromises = batch.map(async (line, idx) => {
        const globalIndex = batchStart + idx
        const voiceId = line.speaker === 'HOST'
          ? script.hostVoiceId
          : script.guestVoiceId

        try {
          const buffer = await generateDialogueSegment(
            line.text,
            voiceId,
            script.model || 'eleven_v3'
          )
          console.log(`[Podcast] Line ${globalIndex + 1}: generated ${buffer.length} bytes`)
          return { index: globalIndex, buffer, success: true }
        } catch (error) {
          console.error(`[Podcast] Line ${globalIndex + 1} failed:`, error)
          return { index: globalIndex, buffer: Buffer.alloc(0), success: false }
        }
      })

      const batchResults = await Promise.all(batchPromises)

      for (const result of batchResults) {
        audioSegments[result.index] = result.buffer
      }

      console.log(`[Podcast] Batch ${batchNum}/${totalBatches} complete`)
    }

    // Check how many segments we got
    const successfulSegments = audioSegments.filter(b => b && b.length > 0).length
    console.log(`[Podcast] Generated ${successfulSegments}/${validLines.length} audio segments`)

    // Build ordered list of audio buffers with silence between speaker changes
    const audioBuffers: Buffer[] = []
    let previousSpeaker: 'HOST' | 'GUEST' | null = null

    for (let i = 0; i < validLines.length; i++) {
      const line = validLines[i]
      const segment = audioSegments[i]

      if (!segment || segment.length === 0) continue

      // Add silence between different speakers
      if (previousSpeaker && previousSpeaker !== line.speaker) {
        audioBuffers.push(silenceBuffer)
      }

      audioBuffers.push(segment)
      previousSpeaker = line.speaker
    }

    // Use proper MP3 concatenation (strips ID3 tags from subsequent files)
    console.log(`[Podcast] Concatenating ${audioBuffers.length} audio buffers...`)
    const combinedAudio = concatenateMp3Buffers(audioBuffers)

    // Estimate duration (MP3 at 128kbps = 16KB per second)
    const durationSeconds = Math.round(combinedAudio.length / (128 * 1024 / 8))

    console.log(`[Podcast] Generated ${validLines.length} segments, ${combinedAudio.length} bytes, ~${durationSeconds}s total`)

    return {
      success: true,
      audioBuffer: combinedAudio,
      durationSeconds,
    }
  } catch (error) {
    console.error('[Podcast] Generation failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Parse a raw script text into structured PodcastScript lines
 *
 * Supports formats:
 * - "HOST: [cheerfully] Welcome everyone!"
 * - "GUEST: Thanks for having me."
 *
 * @param rawScript - Raw text script with HOST:/GUEST: prefixes
 * @returns Array of parsed PodcastLine objects
 */
export function parseScriptText(rawScript: string): PodcastLine[] {
  const lines: PodcastLine[] = []

  // Split by newlines and process each line
  const rawLines = rawScript.split('\n').filter(line => line.trim())

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim()

    // Match "HOST: text" or "GUEST: text" patterns
    const hostMatch = trimmed.match(/^HOST:\s*(.+)$/i)
    const guestMatch = trimmed.match(/^GUEST:\s*(.+)$/i)

    if (hostMatch) {
      lines.push({ speaker: 'HOST', text: hostMatch[1].trim() })
    } else if (guestMatch) {
      lines.push({ speaker: 'GUEST', text: guestMatch[1].trim() })
    }
    // Skip lines that don't match either pattern
  }

  return lines
}

/**
 * Estimate podcast duration from script
 * Based on average speaking rate of ~150 words per minute
 */
export function estimatePodcastDuration(script: PodcastLine[]): number {
  const totalWords = script.reduce((sum, line) => {
    // Remove emotion tags for word count
    const cleanText = line.text.replace(/\[[^\]]+\]/g, '').trim()
    return sum + cleanText.split(/\s+/).length
  }, 0)

  // ~150 words per minute, return seconds
  return Math.round((totalWords / 150) * 60)
}

/**
 * Validate that a script uses proper emotion tags
 * Returns warnings for any invalid tags found
 */
export function validateScriptEmotions(script: PodcastLine[]): string[] {
  const warnings: string[] = []
  const validTags = new Set(EMOTION_TAGS)

  for (let i = 0; i < script.length; i++) {
    const line = script[i]
    const emotionMatches = line.text.matchAll(/\[(\w+)\]/g)

    for (const match of emotionMatches) {
      const tag = match[1].toLowerCase()
      if (!validTags.has(tag as EmotionTag)) {
        warnings.push(`Line ${i + 1}: Unknown emotion tag [${match[1]}]`)
      }
    }
  }

  return warnings
}
