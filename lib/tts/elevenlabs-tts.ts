/**
 * Podcast TTS Module
 * OpenAI TTS for podcast dialogue generation
 * (Legacy filename — originally included ElevenLabs, now OpenAI-only)
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * A single line of dialogue in a podcast script
 */
export interface PodcastLine {
  speaker: 'HOST' | 'GUEST'
  text: string // Can include emotion tags like [cheerfully] or free-form [warm and upbeat, like greeting a friend]
  overlapping?: boolean // True when marked with (overlapping) — both speakers audible simultaneously
}

/**
 * Complete podcast script structure
 */
export interface PodcastScript {
  lines: PodcastLine[]
  hostVoiceId: string
  guestVoiceId: string
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
  overlapping?: boolean // True for (overlapping) lines
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
 * OpenAI TTS voice IDs
 */
export type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'nova' | 'onyx' | 'shimmer' | 'coral' | 'ash' | 'sage' | 'ballad' | 'verse' | 'marin' | 'cedar'

/**
 * OpenAI TTS model
 */
export type OpenAIModel = 'tts-1' | 'tts-1-hd' | 'gpt-4o-mini-tts'

// ============================================================================
// TEXT PROCESSING
// ============================================================================

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
 * Directive tags that control timing/atmosphere and should NOT be stripped as emotion tags.
 * These are handled separately by stripDirectiveTags().
 */
const DIRECTIVE_TAG_NAMES = new Set(['beat', 'short pause', 'longer pause', 'paper rustle', 'sip'])

/**
 * Strip emotion tags from text (for providers that don't support them, like OpenAI tts-1/tts-1-hd)
 * Strips any [...] block EXCEPT directive tags (beat, short pause, etc.)
 * "[warm and upbeat] Hello world!" -> "Hello world!"
 * "[beat] Hello world!" -> "[beat] Hello world!" (preserved)
 */
export function stripEmotionTags(text: string): string {
  return text.replace(/\[([^\]]+)\]\s*/g, (match, content: string) => {
    if (DIRECTIVE_TAG_NAMES.has(content.toLowerCase().trim())) return match
    return ''
  }).trim()
}

/**
 * Extract emotion tag from text (for gpt-4o-mini-tts instructions parameter)
 * Supports both legacy single-word tags and free-form descriptions:
 * "[cheerfully] Hello!" -> { emotion: 'cheerfully', cleanText: 'Hello!' }
 * "[warm and upbeat, like greeting a friend] Hello!" -> { emotion: 'warm and upbeat, like greeting a friend', cleanText: 'Hello!' }
 * "Hello!" -> { emotion: null, cleanText: 'Hello!' }
 */
export function extractEmotionTag(text: string): { emotion: string | null; cleanText: string } {
  const match = text.match(/^\[([^\]]+)\]\s*/)
  if (match) {
    const content = match[1].trim()
    // Skip directive tags — those are timing annotations, not emotions
    if (DIRECTIVE_TAG_NAMES.has(content.toLowerCase())) {
      return { emotion: null, cleanText: text }
    }
    return { emotion: content, cleanText: text.slice(match[0].length) }
  }
  return { emotion: null, cleanText: text }
}

/**
 * Legacy lookup table for known single-word emotion tags.
 * Format follows OpenAI's recommended pattern for gpt-4o-mini-tts instructions:
 * Voice Affect + Tone + Pacing + Emotion descriptors.
 */
const LEGACY_EMOTION_INSTRUCTIONS: Record<string, string> = {
  cheerfully: 'Voice Affect: Cheerful and warm. Tone: Upbeat and positive, genuinely happy. Pacing: Slightly faster, energetic.',
  thoughtfully: 'Voice Affect: Contemplative and measured. Tone: Reflective, as if weighing each word. Pacing: Slower, with natural pauses between thoughts.',
  seriously: 'Voice Affect: Grave and authoritative. Tone: Earnest, conveying importance and weight. Pacing: Deliberate and measured, no rushing.',
  excitedly: 'Voice Affect: Enthusiastic, barely contained energy. Tone: Thrilled, infectious excitement. Pacing: Fast, breathless, words tumbling out.',
  skeptically: 'Voice Affect: Doubtful, questioning. Tone: Unconvinced, probing. Pacing: Measured, with slight rises at the end of phrases.',
  laughing: 'Voice Affect: Amused, speaking through laughter. Tone: Warm, genuine amusement. Emotion: Let a real laugh break through between words.',
  sighing: 'Voice Affect: Reflective, slightly weary. Tone: Resigned or exasperated. Pacing: Start with an audible exhale, then slower delivery.',
  whispering: 'Voice Affect: Soft, intimate, conspiratorial. Tone: Secretive, drawing the listener in. Pacing: Slower, breathy, low volume.',
  interrupting: 'Voice Affect: Urgent, assertive. Tone: Cannot wait to speak, jumping in. Pacing: Abrupt start, fast, overlapping energy.',
  curiously: 'Voice Affect: Inquisitive, fascinated. Tone: Genuinely interested, wanting to know more. Pacing: Engaged, slight rises at key words.',
  dramatically: 'Voice Affect: Theatrical, expressive. Tone: Grand, with flair. Pacing: Varied — pauses before reveals, emphasis on key words.',
  calmly: 'Voice Affect: Steady, grounded, reassuring. Tone: Composed, unshakeable. Pacing: Even and unhurried.',
  enthusiastically: 'Voice Affect: Passionate, high energy. Tone: Genuinely thrilled, infectious. Pacing: Fast, animated, pouring energy into every word.',
}

/**
 * Map emotion description to a natural language instruction for gpt-4o-mini-tts.
 *
 * The script generator already produces rich, structured emotion descriptions
 * like "[cheerful and warm, genuinely happy, slightly faster pacing]".
 * These are passed directly as the instruction — no wrapping needed.
 * Adding a generic base instruction dilutes the specific emotion.
 */
export function emotionToInstruction(emotion: string | null): string {
  if (!emotion) return 'Speak naturally as a conversational podcast host.'

  // Check legacy lookup table for single-word tags (backwards compat)
  const legacyInstruction = LEGACY_EMOTION_INSTRUCTIONS[emotion.toLowerCase()]
  if (legacyInstruction) {
    return legacyInstruction
  }

  // Free-form descriptions from the script generator are already rich enough.
  // Pass them directly — the model responds better to concise, specific direction.
  return emotion
}

/**
 * Strip directive tags from script text before sending to TTS.
 * These are script-level annotations for pauses and atmosphere,
 * not meant to be spoken aloud.
 */
export function stripDirectiveTags(text: string): string {
  return text.replace(/\[(?:beat|short pause|longer pause|paper rustle|sip)\]\s*/gi, '').trim()
}

// ============================================================================
// OPENAI TTS GENERATION
// ============================================================================

/**
 * Generate a dialogue segment using OpenAI TTS
 * For gpt-4o-mini-tts: extracts emotion tag as instructions parameter
 * For tts-1/tts-1-hd: strips emotion tags
 */
async function generateDialogueSegmentOpenAI(
  text: string,
  voiceId: OpenAIVoice,
  model: OpenAIModel = 'gpt-4o-mini-tts'
): Promise<Buffer> {
  const isGpt4oMiniTts = model === 'gpt-4o-mini-tts'
  let cleanText: string
  let instructions: string | undefined

  if (isGpt4oMiniTts) {
    const { emotion, cleanText: stripped } = extractEmotionTag(text)
    cleanText = prepareTTSText(stripEmotionTags(stripped))
    instructions = emotionToInstruction(emotion)
  } else {
    cleanText = prepareTTSText(stripEmotionTags(text))
  }

  if (!cleanText.trim()) {
    return Buffer.alloc(0)
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }

  console.log(`[TTS-OpenAI] Request: model=${model}, voice=${voiceId}, textLength=${cleanText.length}${instructions ? ', instructions=yes' : ''}`)

  const body: Record<string, unknown> = {
    model,
    voice: voiceId,
    input: cleanText,
    response_format: 'mp3',
  }
  if (instructions) {
    body.instructions = instructions
  }

  const PER_CALL_TIMEOUT_MS = 30_000
  const MAX_ATTEMPTS = 3

  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS)
    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        const retriable = response.status === 429 || response.status >= 500
        const err = new Error(`OpenAI TTS API error: ${response.status} - ${errorText}`)
        if (!retriable || attempt === MAX_ATTEMPTS) throw err
        lastErr = err
      } else {
        const arrayBuffer = await response.arrayBuffer()
        return Buffer.from(arrayBuffer)
      }
    } catch (err) {
      lastErr = err
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (attempt === MAX_ATTEMPTS) {
        if (isAbort) throw new Error(`OpenAI TTS timeout after ${PER_CALL_TIMEOUT_MS}ms (attempt ${attempt})`)
        throw err
      }
    } finally {
      clearTimeout(timeoutId)
    }
    const backoffMs = 500 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250)
    console.log(`[TTS-OpenAI] Retrying attempt ${attempt + 1}/${MAX_ATTEMPTS} in ${backoffMs}ms`)
    await new Promise(r => setTimeout(r, backoffMs))
  }
  throw lastErr instanceof Error ? lastErr : new Error('OpenAI TTS failed')
}

// ============================================================================
// MP3 CONCATENATION HELPERS
// ============================================================================

/**
 * Generate a short silence buffer (for natural pauses between speakers)
 * Creates a ~50ms pause using minimal valid MP3 frames (mono to match output)
 */
function generateSilenceBuffer(): Buffer {
  const silenceFrames: number[] = []
  const frameHeader = [0xFF, 0xFB, 0x90, 0xC0]
  const frameData = new Array(417 - 4).fill(0)

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

  if (buffer.length >= 10 &&
      buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    const size = ((buffer[6] & 0x7F) << 21) |
                 ((buffer[7] & 0x7F) << 14) |
                 ((buffer[8] & 0x7F) << 7) |
                 (buffer[9] & 0x7F)
    offset = 10 + size
  }

  while (offset < buffer.length - 1) {
    if (buffer[offset] === 0xFF && (buffer[offset + 1] & 0xE0) === 0xE0) {
      return offset
    }
    offset++
  }

  return 0
}

function findMpegAudioEnd(buffer: Buffer): number {
  if (buffer.length >= 128) {
    const tagStart = buffer.length - 128
    if (buffer[tagStart] === 0x54 && buffer[tagStart + 1] === 0x41 && buffer[tagStart + 2] === 0x47) {
      return tagStart
    }
  }
  return buffer.length
}

function isXingFrame(buffer: Buffer, offset: number): boolean {
  if (offset + 36 > buffer.length) return false
  const xingOffsets = [17, 21, 32, 36]
  for (const xingOffset of xingOffsets) {
    if (offset + 4 + xingOffset + 4 <= buffer.length) {
      const tag = buffer.toString('ascii', offset + 4 + xingOffset, offset + 4 + xingOffset + 4)
      if (tag === 'Xing' || tag === 'Info') return true
    }
  }
  return false
}

function extractMpegFrames(buffer: Buffer): Buffer {
  const start = findMpegAudioStart(buffer)
  const end = findMpegAudioEnd(buffer)
  if (start >= end || start >= buffer.length) return buffer

  let audioStart = start
  if (isXingFrame(buffer, start)) {
    audioStart = start + 417
    while (audioStart < end - 1) {
      if (buffer[audioStart] === 0xFF && (buffer[audioStart + 1] & 0xE0) === 0xE0) break
      audioStart++
    }
  }

  return buffer.subarray(audioStart, end)
}

function createXingHeader(totalFrames: number, totalBytes: number): Buffer {
  const frameSize = 417
  const header = Buffer.alloc(frameSize)
  header[0] = 0xFF; header[1] = 0xFB; header[2] = 0x90; header[3] = 0xC4
  const xingOffset = 21
  header.write('Info', xingOffset)
  header.writeUInt32BE(0x00000003, xingOffset + 4)
  header.writeUInt32BE(totalFrames, xingOffset + 8)
  header.writeUInt32BE(totalBytes, xingOffset + 12)
  return header
}

function countMpegFrames(buffer: Buffer): number {
  let count = 0
  let offset = 0
  while (offset < buffer.length - 1) {
    if (buffer[offset] === 0xFF && (buffer[offset + 1] & 0xE0) === 0xE0) {
      count++
      offset += 417
    } else {
      offset++
    }
  }
  return count
}

function concatenateMp3Buffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) return Buffer.alloc(0)
  if (buffers.length === 1) return buffers[0]

  const extractedFrames: Buffer[] = []
  for (const buffer of buffers) {
    if (!buffer || buffer.length === 0) continue
    extractedFrames.push(extractMpegFrames(buffer))
  }

  const audioData = Buffer.concat(extractedFrames)
  const totalFrames = countMpegFrames(audioData)
  const totalBytes = audioData.length + 417

  const xingFrame = createXingHeader(totalFrames + 1, totalBytes)
  console.log(`[MP3] Created Xing header: ${totalFrames} frames, ${totalBytes} bytes`)

  return Buffer.concat([xingFrame, audioData])
}

// ============================================================================
// PODCAST GENERATION (Legacy — new pipeline uses jobs/process)
// ============================================================================

/**
 * Generate complete podcast audio from a script
 */
export interface PodcastProgressEvent {
  type: 'start' | 'line' | 'error' | 'done'
  index?: number
  total?: number
  speaker?: 'HOST' | 'GUEST'
  elapsedMs?: number
  bytes?: number
  message?: string
}

export async function generatePodcastDialogue(
  script: PodcastScript,
  onProgress?: (event: PodcastProgressEvent) => void
): Promise<PodcastGenerationResult> {
  try {
    if (!script.lines || script.lines.length === 0) {
      return { success: false, error: 'Script has no dialogue lines' }
    }

    const validLines = script.lines.filter(line => line.text.trim())
    if (validLines.length === 0) {
      return { success: false, error: 'Script has no valid dialogue lines' }
    }

    const silenceBuffer = generateSilenceBuffer()
    const model = script.openaiModel || 'gpt-4o-mini-tts'

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return { success: false, error: 'OPENAI_API_KEY environment variable is not set' }
    }
    console.log(`[Podcast] OpenAI API key present`)
    console.log(`[Podcast] Generating ${validLines.length} lines with OpenAI (model=${model})`)

    const audioSegments: Buffer[] = new Array(validLines.length).fill(Buffer.alloc(0))
    const errors: string[] = []
    const CONCURRENCY = 4
    onProgress?.({ type: 'start', total: validLines.length })

    let cursor = 0
    let completed = 0
    const workers = Array.from({ length: Math.min(CONCURRENCY, validLines.length) }, async () => {
      while (cursor < validLines.length) {
        const i = cursor++
        const line = validLines[i]
        const voiceId = line.speaker === 'HOST'
          ? script.hostVoiceId
          : script.guestVoiceId

        try {
          const startTime = Date.now()
          const ttsText = stripDirectiveTags(line.text)

          if (!ttsText) {
            console.log(`[Podcast] Skipping empty line ${i + 1}/${validLines.length} after directive strip`)
            completed++
            onProgress?.({ type: 'line', index: i + 1, total: validLines.length, speaker: line.speaker, bytes: 0, elapsedMs: 0, message: 'skipped' })
            continue
          }

          const buffer = await generateDialogueSegmentOpenAI(
            ttsText,
            voiceId as OpenAIVoice,
            model
          )

          const elapsed = Date.now() - startTime
          console.log(`[Podcast] Line ${i + 1}/${validLines.length}: ${buffer.length} bytes in ${elapsed}ms (${line.speaker})`)
          audioSegments[i] = buffer
          completed++
          onProgress?.({ type: 'line', index: i + 1, total: validLines.length, speaker: line.speaker, bytes: buffer.length, elapsedMs: elapsed })
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          console.error(`[Podcast] Line ${i + 1} FAILED:`, errorMsg)
          errors.push(`Line ${i + 1}: ${errorMsg}`)
          completed++
          onProgress?.({ type: 'error', index: i + 1, total: validLines.length, message: errorMsg })
        }
      }
    })
    await Promise.all(workers)
    void completed

    const successfulSegments = audioSegments.filter(b => b && b.length > 0).length
    const failedSegments = validLines.length - successfulSegments
    const totalBytes = audioSegments.reduce((sum, b) => sum + (b?.length || 0), 0)
    console.log(`[Podcast] Generated ${successfulSegments}/${validLines.length} segments (${failedSegments} failed), total ${totalBytes} bytes`)

    const finalBuffers: Buffer[] = []
    const segmentMetadata: SegmentMetadata[] = []
    let previousSpeaker: 'HOST' | 'GUEST' | null = null
    let previousEndTime = 0
    let currentTime = 0

    const NORMAL_GAP = 0.05

    for (let i = 0; i < validLines.length; i++) {
      const line = validLines[i]
      const segment = audioSegments[i]

      if (!segment || segment.length === 0) continue

      const segmentDuration = segment.length / (128 * 1024 / 8)

      if (previousSpeaker && previousSpeaker !== line.speaker) {
        currentTime = previousEndTime + NORMAL_GAP
        finalBuffers.push(silenceBuffer)
      } else if (previousSpeaker === line.speaker) {
        currentTime = previousEndTime
      }

      segmentMetadata.push({
        index: segmentMetadata.length,
        speaker: line.speaker,
        text: line.text,
        startTime: currentTime,
        durationEstimate: segmentDuration,
        overlapping: line.overlapping,
      })

      finalBuffers.push(segment)
      previousEndTime = currentTime + segmentDuration
      previousSpeaker = line.speaker
    }

    const bufferSizes = finalBuffers.map(b => b.length)
    console.log(`[Podcast] Concatenating ${finalBuffers.length} buffers: [${bufferSizes.slice(0, 5).join(', ')}${bufferSizes.length > 5 ? '...' : ''}]`)
    const combinedAudio = concatenateMp3Buffers(finalBuffers)

    const durationSeconds = Math.round(combinedAudio.length / (128 * 1024 / 8))
    console.log(`[Podcast] FINAL: ${combinedAudio.length} bytes, ~${durationSeconds}s (from ${finalBuffers.length} buffers)`)

    return {
      success: true,
      audioBuffer: combinedAudio,
      segmentBuffers: audioSegments.filter(b => b && b.length > 0),
      segmentMetadata,
      durationSeconds,
      debug: {
        totalLines: validLines.length,
        successfulLines: successfulSegments,
        failedLines: failedSegments,
        errors: errors.slice(0, 10),
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

// ============================================================================
// SCRIPT PARSING & UTILITIES
// ============================================================================

/**
 * Parse a raw script text into structured PodcastScript lines
 */
export function parseScriptText(rawScript: string): PodcastLine[] {
  const lines: PodcastLine[] = []
  const rawLines = rawScript.split('\n').filter(line => line.trim())

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim()
    const hostMatch = trimmed.match(/^HOST\s*(?:\(overlapping\))?\s*:\s*(.+)$/i)
    const guestMatch = trimmed.match(/^GUEST\s*(?:\(overlapping\))?\s*:\s*(.+)$/i)
    const isOverlapping = /\(overlapping\)/i.test(trimmed)

    if (hostMatch) {
      lines.push({ speaker: 'HOST', text: hostMatch[1].trim(), ...(isOverlapping && { overlapping: true }) })
    } else if (guestMatch) {
      lines.push({ speaker: 'GUEST', text: guestMatch[1].trim(), ...(isOverlapping && { overlapping: true }) })
    }
  }

  return lines
}

/**
 * Estimate podcast duration from script
 * Based on average speaking rate of ~150 words per minute
 */
export function estimatePodcastDuration(script: PodcastLine[]): number {
  const totalWords = script.reduce((sum, line) => {
    const cleanText = line.text.replace(/\[[^\]]+\]/g, '').trim()
    return sum + cleanText.split(/\s+/).length
  }, 0)
  return Math.round((totalWords / 150) * 60)
}

/**
 * Validate that a script uses proper emotion tags.
 * With free-form emotions, all bracketed content is valid — always returns empty.
 * Kept for backwards compatibility.
 */
export function validateScriptEmotions(_script: PodcastLine[]): string[] {
  return []
}
