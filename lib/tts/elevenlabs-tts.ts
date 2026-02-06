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
  debug?: {
    totalLines: number
    successfulLines: number
    failedLines: number
    errors: string[]
  }
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
 * Returns PCM audio (16-bit signed, 44.1kHz, mono) for consistent concatenation
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

  // Use PCM format for consistent audio that can be properly concatenated
  // pcm_44100 returns 16-bit signed, little-endian, mono
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: model,
      output_format: 'pcm_44100',
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
 * Creates ~300ms pause as PCM data (16-bit signed, 44.1kHz, mono)
 */
function generateSilenceBuffer(): Buffer {
  // 44100 samples/sec * 0.3 sec * 2 bytes/sample = 26460 bytes
  const sampleCount = Math.round(44100 * 0.3)
  return Buffer.alloc(sampleCount * 2) // 16-bit = 2 bytes per sample, filled with zeros
}

/**
 * Create a WAV file header for PCM data
 * PCM format: 16-bit signed, little-endian, mono, 44.1kHz
 */
function createWavHeader(dataLength: number): Buffer {
  const header = Buffer.alloc(44)
  const sampleRate = 44100
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)

  // RIFF header
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataLength, 4) // File size - 8
  header.write('WAVE', 8)

  // fmt chunk
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // Chunk size
  header.writeUInt16LE(1, 20) // Audio format (1 = PCM)
  header.writeUInt16LE(numChannels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)

  // data chunk
  header.write('data', 36)
  header.writeUInt32LE(dataLength, 40)

  return header
}

/**
 * Concatenate PCM buffers and convert to WAV format
 * All buffers are expected to be 16-bit signed, 44.1kHz, mono PCM
 */
function concatenatePcmToWav(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) return Buffer.alloc(0)

  // Filter out empty buffers and concatenate
  const validBuffers = buffers.filter(b => b && b.length > 0)
  const pcmData = Buffer.concat(validBuffers)

  // Create WAV header and combine with PCM data
  const wavHeader = createWavHeader(pcmData.length)
  return Buffer.concat([wavHeader, pcmData])
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

    // Verify API key is set
    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
      console.error('[Podcast] ELEVENLABS_API_KEY is not set!')
      return { success: false, error: 'ELEVENLABS_API_KEY environment variable is not set' }
    }
    console.log(`[Podcast] API key present: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)} (${apiKey.length} chars)`)

    console.log(`[Podcast] Generating ${validLines.length} lines SEQUENTIALLY`)

    // Generate all audio segments sequentially to avoid rate limiting
    const audioSegments: Buffer[] = []
    const errors: string[] = []

    for (let i = 0; i < validLines.length; i++) {
      const line = validLines[i]
      const voiceId = line.speaker === 'HOST'
        ? script.hostVoiceId
        : script.guestVoiceId

      try {
        const startTime = Date.now()
        const buffer = await generateDialogueSegment(
          line.text,
          voiceId,
          script.model || 'eleven_v3'
        )
        const elapsed = Date.now() - startTime
        console.log(`[Podcast] Line ${i + 1}/${validLines.length}: ${buffer.length} bytes in ${elapsed}ms (${line.speaker})`)
        audioSegments.push(buffer)

        // Small delay between requests to avoid rate limiting
        if (i < validLines.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error(`[Podcast] Line ${i + 1} FAILED:`, errorMsg)
        errors.push(`Line ${i + 1}: ${errorMsg}`)
        audioSegments.push(Buffer.alloc(0))
      }
    }

    // Check how many segments we got
    const successfulSegments = audioSegments.filter(b => b && b.length > 0).length
    const failedSegments = validLines.length - successfulSegments
    const totalBytes = audioSegments.reduce((sum, b) => sum + (b?.length || 0), 0)
    console.log(`[Podcast] Generated ${successfulSegments}/${validLines.length} segments (${failedSegments} failed), total ${totalBytes} bytes`)

    // Build ordered list of audio buffers with silence between speaker changes
    const finalBuffers: Buffer[] = []
    let previousSpeaker: 'HOST' | 'GUEST' | null = null

    for (let i = 0; i < validLines.length; i++) {
      const line = validLines[i]
      const segment = audioSegments[i]

      if (!segment || segment.length === 0) continue

      // Add silence between different speakers
      if (previousSpeaker && previousSpeaker !== line.speaker) {
        finalBuffers.push(silenceBuffer)
      }

      finalBuffers.push(segment)
      previousSpeaker = line.speaker
    }

    // Concatenate PCM buffers and convert to WAV
    const bufferSizes = finalBuffers.map(b => b.length)
    console.log(`[Podcast] Concatenating ${finalBuffers.length} PCM buffers: [${bufferSizes.slice(0, 5).join(', ')}${bufferSizes.length > 5 ? '...' : ''}]`)
    const combinedAudio = concatenatePcmToWav(finalBuffers)

    // Calculate duration from PCM data (44100 samples/sec * 2 bytes/sample = 88200 bytes/sec)
    const pcmDataLength = combinedAudio.length - 44 // Subtract WAV header
    const durationSeconds = Math.round(pcmDataLength / 88200)

    console.log(`[Podcast] FINAL: ${combinedAudio.length} bytes, ~${durationSeconds}s (from ${finalBuffers.length} buffers)`)

    return {
      success: true,
      audioBuffer: combinedAudio,
      durationSeconds,
      debug: {
        totalLines: validLines.length,
        successfulLines: successfulSegments,
        failedLines: failedSegments,
        errors: errors.slice(0, 10), // First 10 errors
      },
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
