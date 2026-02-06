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
  // Provider selection (default: elevenlabs)
  provider?: PodcastProvider
  // OpenAI-specific settings
  openaiModel?: OpenAIModel
}

/**
 * Metadata for a single audio segment
 */
export interface SegmentMetadata {
  index: number
  speaker: 'HOST' | 'GUEST'
  text: string
  startTime: number // Calculated start time in seconds
  durationEstimate: number // Estimated duration in seconds
}

/**
 * Result of podcast generation
 */
export interface PodcastGenerationResult {
  success: boolean
  audioBuffer?: Buffer
  segmentBuffers?: Buffer[] // Individual segments for client-side processing
  segmentMetadata?: SegmentMetadata[] // Metadata for stereo mixing
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
 * Pronunciation replacements for TTS
 * Maps brand names and technical terms to their phonetic equivalents
 */
const TTS_PRONUNCIATIONS: Record<string, string> = {
  'Synthszr': 'Synthesizer',
  'synthszr': 'synthesizer',
  'SYNTHSZR': 'SYNTHESIZER',
}

/**
 * Prepare text for TTS by applying pronunciation replacements
 * This ensures brand names like "Synthszr" are pronounced correctly
 */
function prepareTTSText(text: string): string {
  let result = text
  for (const [from, to] of Object.entries(TTS_PRONUNCIATIONS)) {
    result = result.replaceAll(from, to)
  }
  return result
}

/**
 * Strip emotion tags from text (for providers that don't support them, like OpenAI)
 * "[cheerfully] Hello world!" -> "Hello world!"
 */
export function stripEmotionTags(text: string): string {
  return text.replace(/\[(?:cheerfully|thoughtfully|seriously|excitedly|skeptically|laughing|sighing|whispering|interrupting|curiously|dramatically|calmly|enthusiastically)\]\s*/gi, '').trim()
}

/**
 * TTS provider for podcast generation
 */
export type PodcastProvider = 'elevenlabs' | 'openai'

/**
 * OpenAI TTS voice IDs
 */
export type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'nova' | 'onyx' | 'shimmer'

/**
 * OpenAI TTS model
 */
export type OpenAIModel = 'tts-1' | 'tts-1-hd'

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

  // Apply pronunciation replacements (e.g., "Synthszr" -> "Synthesizer")
  const ttsText = prepareTTSText(text)

  console.log(`[TTS] Request: model=${model}, voiceId=${voiceId}, textLength=${ttsText.length}`)

  // Use direct fetch instead of SDK for eleven_v3 compatibility
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

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Generate a dialogue segment using OpenAI TTS
 * Emotion tags are automatically stripped since OpenAI doesn't support them
 */
async function generateDialogueSegmentOpenAI(
  text: string,
  voiceId: OpenAIVoice,
  model: OpenAIModel = 'tts-1'
): Promise<Buffer> {
  // Strip emotion tags - OpenAI doesn't support them
  // Then apply pronunciation replacements (e.g., "Synthszr" -> "Synthesizer")
  const cleanText = prepareTTSText(stripEmotionTags(text))

  if (!cleanText.trim()) {
    return Buffer.alloc(0)
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }

  console.log(`[TTS-OpenAI] Request: model=${model}, voice=${voiceId}, textLength=${cleanText.length} (original: ${text.length})`)

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      voice: voiceId,
      input: cleanText,
      response_format: 'mp3',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI TTS API error: ${response.status} - ${errorText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Generate a short silence buffer (for natural pauses between speakers)
 * Creates a ~50ms pause using minimal valid MP3 frames (mono to match ElevenLabs output)
 */
function generateSilenceBuffer(): Buffer {
  // Minimal valid MP3 silence frame (MPEG Audio Layer 3, 128kbps, 44.1kHz, MONO)
  // Each frame is ~26ms at 128kbps
  const silenceFrames: number[] = []

  // MP3 frame header for 128kbps, 44.1kHz, MONO
  // 0xFF 0xFB = Frame sync + MPEG1 Layer3
  // 0x90 = Bitrate 128kbps, Sample rate 44.1kHz, No padding
  // 0xC0 = Mono mode (bits 7-6 = 11), no mode ext, no copyright, no original, no emphasis
  const frameHeader = [0xFF, 0xFB, 0x90, 0xC0]
  const frameData = new Array(417 - 4).fill(0) // Frame size for 128kbps mono @ 44.1kHz

  // Add 2 frames for ~50ms of silence (natural breath pause)
  for (let i = 0; i < 2; i++) {
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
 * Check if an MPEG frame is a Xing/Info header frame (contains no audio)
 */
function isXingFrame(buffer: Buffer, offset: number): boolean {
  if (offset + 36 > buffer.length) return false

  // Check for "Xing" or "Info" tag at various offsets depending on MPEG version and channel mode
  // For MPEG1 Layer3: offset 32 (stereo) or 17 (mono) after frame header
  const xingOffsets = [17, 21, 32, 36]

  for (const xingOffset of xingOffsets) {
    if (offset + 4 + xingOffset + 4 <= buffer.length) {
      const tag = buffer.toString('ascii', offset + 4 + xingOffset, offset + 4 + xingOffset + 4)
      if (tag === 'Xing' || tag === 'Info') {
        return true
      }
    }
  }
  return false
}

/**
 * Extract raw MPEG audio frames from an MP3 buffer
 * Strips ID3v2 header, ID3v1 footer, and Xing/Info headers
 */
function extractMpegFrames(buffer: Buffer): Buffer {
  const start = findMpegAudioStart(buffer)
  const end = findMpegAudioEnd(buffer)

  if (start >= end || start >= buffer.length) {
    return buffer // Return as-is if we can't parse it
  }

  // Check if first frame is a Xing/Info header and skip it
  let audioStart = start
  if (isXingFrame(buffer, start)) {
    // Skip the Xing frame (typically 417 bytes for 128kbps mono)
    audioStart = start + 417
    // Find next valid frame sync
    while (audioStart < end - 1) {
      if (buffer[audioStart] === 0xFF && (buffer[audioStart + 1] & 0xE0) === 0xE0) {
        break
      }
      audioStart++
    }
  }

  return buffer.subarray(audioStart, end)
}

/**
 * Create a Xing header for proper browser MP3 playback
 * The Xing header contains total frames and bytes, enabling accurate seeking
 */
function createXingHeader(totalFrames: number, totalBytes: number): Buffer {
  // Create a minimal MP3 frame with Xing header
  // MP3 frame header: FF FB 90 C4 (MPEG1 Layer3 128kbps 44.1kHz mono)
  const frameSize = 417 // Frame size for 128kbps mono
  const header = Buffer.alloc(frameSize)

  // MP3 frame header
  header[0] = 0xFF
  header[1] = 0xFB
  header[2] = 0x90
  header[3] = 0xC4

  // Side info (mono) - 17 bytes of zeros
  // Xing header starts at offset 21 for mono
  const xingOffset = 21

  // "Info" tag (for CBR) - use Info instead of Xing
  header.write('Info', xingOffset)

  // Flags: frames + bytes present (0x03)
  header.writeUInt32BE(0x00000003, xingOffset + 4)

  // Total frames
  header.writeUInt32BE(totalFrames, xingOffset + 8)

  // Total bytes
  header.writeUInt32BE(totalBytes, xingOffset + 12)

  return header
}

/**
 * Count MPEG frames in a buffer
 */
function countMpegFrames(buffer: Buffer): number {
  let count = 0
  let offset = 0

  while (offset < buffer.length - 1) {
    // Find frame sync
    if (buffer[offset] === 0xFF && (buffer[offset + 1] & 0xE0) === 0xE0) {
      count++
      // Skip frame (assuming 128kbps mono @ 44.1kHz = 417 bytes per frame)
      offset += 417
    } else {
      offset++
    }
  }

  return count
}

/**
 * Concatenate multiple MP3 buffers properly
 * Strips ID3 tags from subsequent files and adds Xing header for browser compatibility
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

  // Concatenate all frames
  const audioData = Buffer.concat(extractedFrames)

  // Count total frames for Xing header
  const totalFrames = countMpegFrames(audioData)
  const totalBytes = audioData.length + 417 // Include Xing frame

  // Create Xing header and prepend it
  const xingFrame = createXingHeader(totalFrames + 1, totalBytes)

  console.log(`[MP3] Created Xing header: ${totalFrames} frames, ${totalBytes} bytes`)

  return Buffer.concat([xingFrame, audioData])
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
    const provider = script.provider || 'elevenlabs'

    // Verify API key is set based on provider
    if (provider === 'elevenlabs') {
      const apiKey = process.env.ELEVENLABS_API_KEY
      if (!apiKey) {
        console.error('[Podcast] ELEVENLABS_API_KEY is not set!')
        return { success: false, error: 'ELEVENLABS_API_KEY environment variable is not set' }
      }
      console.log(`[Podcast] ElevenLabs API key present: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`)
    } else {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        console.error('[Podcast] OPENAI_API_KEY is not set!')
        return { success: false, error: 'OPENAI_API_KEY environment variable is not set' }
      }
      console.log(`[Podcast] OpenAI API key present: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`)
    }

    console.log(`[Podcast] Generating ${validLines.length} lines with ${provider.toUpperCase()}`)

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
        let buffer: Buffer

        if (provider === 'openai') {
          // OpenAI: emotion tags are stripped automatically
          buffer = await generateDialogueSegmentOpenAI(
            line.text,
            voiceId as OpenAIVoice,
            script.openaiModel || 'tts-1'
          )
        } else {
          // ElevenLabs: emotion tags are preserved
          buffer = await generateDialogueSegment(
            line.text,
            voiceId,
            script.model || 'eleven_v3'
          )
        }

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

    // Build ordered list of audio buffers and metadata for stereo mixing
    const finalBuffers: Buffer[] = []
    const segmentMetadata: SegmentMetadata[] = []
    let previousSpeaker: 'HOST' | 'GUEST' | null = null
    let previousEndTime = 0
    let currentTime = 0

    // Timing constants for natural conversation flow
    const NORMAL_GAP = 0.05      // 50ms - minimal natural pause
    const INTERRUPTION_OVERLAP = -0.3  // -300ms - speaker starts before previous ends

    for (let i = 0; i < validLines.length; i++) {
      const line = validLines[i]
      const segment = audioSegments[i]

      if (!segment || segment.length === 0) continue

      // Estimate segment duration (MP3 at 128kbps = 16KB per second)
      const segmentDuration = segment.length / (128 * 1024 / 8)

      // Check for interruption tag (only works with ElevenLabs, stripped for OpenAI)
      const isInterruption = line.text.toLowerCase().includes('[interrupting]')

      // Calculate start time based on conversation flow
      if (previousSpeaker && previousSpeaker !== line.speaker) {
        if (isInterruption && provider === 'elevenlabs') {
          // Overlap with previous speaker for interruption effect
          currentTime = Math.max(0, previousEndTime + INTERRUPTION_OVERLAP)
          // Don't add silence buffer for overlapping speech
        } else {
          // Normal speaker change - minimal gap
          currentTime = previousEndTime + NORMAL_GAP
          // Add tiny silence buffer for clean transition
          finalBuffers.push(silenceBuffer)
        }
      } else if (previousSpeaker === line.speaker) {
        // Same speaker continues - no gap needed
        currentTime = previousEndTime
      }

      // Add metadata for stereo mixing
      segmentMetadata.push({
        index: segmentMetadata.length,
        speaker: line.speaker,
        text: line.text,
        startTime: currentTime,
        durationEstimate: segmentDuration,
      })

      finalBuffers.push(segment)
      previousEndTime = currentTime + segmentDuration
      previousSpeaker = line.speaker
    }

    // Use proper MP3 concatenation (strips ID3 tags from subsequent files)
    const bufferSizes = finalBuffers.map(b => b.length)
    console.log(`[Podcast] Concatenating ${finalBuffers.length} buffers: [${bufferSizes.slice(0, 5).join(', ')}${bufferSizes.length > 5 ? '...' : ''}]`)
    const combinedAudio = concatenateMp3Buffers(finalBuffers)

    // Estimate duration (MP3 at 128kbps = 16KB per second)
    const durationSeconds = Math.round(combinedAudio.length / (128 * 1024 / 8))

    console.log(`[Podcast] FINAL: ${combinedAudio.length} bytes, ~${durationSeconds}s (from ${finalBuffers.length} buffers)`)

    return {
      success: true,
      audioBuffer: combinedAudio,
      segmentBuffers: audioSegments.filter(b => b && b.length > 0), // Only dialogue segments, no silence
      segmentMetadata, // For stereo mixing
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
