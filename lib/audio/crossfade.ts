/**
 * Smart Audio Crossfade Utility
 *
 * Intelligent algorithm that analyzes dialogue patterns to create
 * natural-sounding podcast conversations with dynamic overlaps.
 */

import { MPEGDecoder } from 'mpg123-decoder'
import type { AudioEnvelope } from './envelope'
import { sampleEnvelope } from './envelope'
// @breezystack/lamejs is an ESM-compatible fork that works in serverless
import { Mp3Encoder } from '@breezystack/lamejs'

// Production URL for fetching static audio files
// Use www subdomain to avoid redirect (synthszr.com → www.synthszr.com)
const PRODUCTION_URL = 'https://www.synthszr.com'

const getBaseUrl = () => {
  // In production, always use the public production URL
  if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
    return PRODUCTION_URL
  }
  // For local development
  return 'http://localhost:3000'
}

export interface AudioSegment {
  buffer: Buffer
  speaker: 'HOST' | 'GUEST'
  text: string
  overlapping?: boolean // True for (overlapping) lines — additive mix instead of crossfade
}

export interface CrossfadeOptions {
  /** Add intro music at the beginning */
  includeIntro?: boolean
  /** Crossfade duration for intro in seconds (default: 4, kept for backward compat) */
  introCrossfadeSec?: number
  /** Add outro music at the end */
  includeOutro?: boolean
  /** Crossfade duration for outro in seconds (default: 10) */
  outroCrossfadeSec?: number

  // Fine-grained intro settings
  /** Phase 1: Intro at full volume, no dialog (seconds, default 3) */
  introFullSec?: number
  /** Phase 2: Intro as bed music duration (seconds, default 7) */
  introBedSec?: number
  /** Bed volume during intro (0–1, default 0.20) */
  introBedVolume?: number
  /** Phase 3: Intro fade from bed to silence (seconds, default 3) */
  introFadeoutSec?: number
  /** Dialog fade-in at start of phase 2 (seconds, default 1) */
  introDialogFadeInSec?: number

  // Fine-grained outro settings
  /** Outro ease-in to bed volume (seconds, default 3) */
  outroRiseSec?: number
  /** Bed volume during outro hold (0–1, default 0.20) */
  outroBedVolume?: number
  /** When crossfade from bed to 100% starts (seconds from crossfade start, default 7) */
  outroFinalStartSec?: number

  // Curve type controls
  /** Intro fadeout curve shape (default: exponential) */
  introFadeoutCurve?: 'linear' | 'exponential'
  /** Dialog fade-in curve shape (default: exponential) */
  introDialogCurve?: 'linear' | 'exponential'
  /** Outro rise curve shape (default: exponential) */
  outroRiseCurve?: 'linear' | 'exponential'
  /** Outro final curve shape (default: exponential) */
  outroFinalCurve?: 'linear' | 'exponential'

  /** Custom intro audio URL (Vercel Blob). Falls back to static file. */
  introUrl?: string
  /** Custom outro audio URL (Vercel Blob). Falls back to static file. */
  outroUrl?: string

  // Envelope-based mixing (takes precedence over parametric when present)
  introMusicEnvelope?: AudioEnvelope
  introDialogEnvelope?: AudioEnvelope
  outroMusicEnvelope?: AudioEnvelope
  outroDialogEnvelope?: AudioEnvelope

  // Stereo positioning (0 = full left, 1 = full right)
  /** HOST stereo position (default 0.35 = 65% left) */
  stereoHost?: number
  /** GUEST stereo position (default 0.65 = 65% right) */
  stereoGuest?: number

  // Dialog overlap settings (milliseconds)
  /** Short reactions like "Ja!", "Genau!" (default 250) */
  overlapReactionMs?: number
  /** [interrupting] tag (default 180) */
  overlapInterruptMs?: number
  /** Quick answer after question (default 80) */
  overlapQuestionMs?: number
  /** Normal speaker change (default 50) */
  overlapSpeakerChangeMs?: number
  /** Explicit (overlapping) annotation — true simultaneous speech (default 500) */
  overlapOverlappingMs?: number

  /** Progress callback for large-scale concatenation (percent 0-100) */
  onProgress?: (percent: number) => Promise<void>
}

interface AnalyzedSegment {
  pcm: Float32Array[]
  speaker: 'HOST' | 'GUEST'
  text: string
  wordCount: number
  isShortReaction: boolean
  isInterrupting: boolean
  isOverlapping: boolean
  isQuestion: boolean
  endsWithTrailOff: boolean
  silenceAtEndMs: number
}

// Audio settings
const SAMPLE_RATE = 44100
const CHANNELS = 2
const BITRATE = 128

// Stereo panning defaults (matches stereo-mixer.ts)
// 0.0 = full left, 1.0 = full right
const DEFAULT_STEREO_HOST = 0.35    // 65% left, 35% right
const DEFAULT_STEREO_GUEST = 0.65   // 35% left, 65% right

// Overlap defaults (in milliseconds)
const DEFAULT_OVERLAP_SHORT_REACTION = 250
const DEFAULT_OVERLAP_INTERRUPTING = 180
const DEFAULT_OVERLAP_AFTER_QUESTION = 80
const DEFAULT_OVERLAP_SPEAKER_CHANGE = 50
const OVERLAP_SAME_SPEAKER = 0      // Same speaker continues - no overlap
const MIN_SEGMENT_FOR_OVERLAP = 300  // Don't overlap if segment < 300ms

// Large podcast threshold: above this, use fast MP3 concatenation to avoid OOM
const LARGE_PODCAST_THRESHOLD = 40

// Short reaction patterns (German & English)
const SHORT_REACTIONS = new Set([
  // German
  'ja', 'ja!', 'nein', 'mhm', 'hmm', 'aha', 'oh', 'oh!', 'genau', 'genau!',
  'richtig', 'richtig!', 'stimmt', 'stimmt!', 'klar', 'klar!', 'okay', 'ok',
  'echt', 'echt?', 'wirklich', 'wirklich?', 'interessant', 'interessant!',
  'wow', 'krass', 'absolut', 'definitiv', 'natürlich', 'na klar',
  // English
  'yes', 'yes!', 'no', 'yeah', 'right', 'right!', 'exactly', 'exactly!',
  'sure', 'okay', 'interesting', 'interesting!', 'really', 'really?',
  'wow', 'absolutely', 'definitely', 'of course', 'true', 'true!',
])

/**
 * Apply stereo panning to PCM channels based on speaker identity.
 * Uses constant-power panning to maintain perceived loudness.
 */
function applyStereoPosition(pcm: Float32Array[], speaker: 'HOST' | 'GUEST', stereoPositions?: { HOST: number; GUEST: number }): Float32Array[] {
  const pan = stereoPositions?.[speaker] ?? (speaker === 'HOST' ? DEFAULT_STEREO_HOST : DEFAULT_STEREO_GUEST)
  const leftGain = Math.cos(pan * Math.PI / 2)
  const rightGain = Math.sin(pan * Math.PI / 2)

  const mono = pcm[0] // TTS output is mono (both channels identical)
  const left = new Float32Array(mono.length)
  const right = new Float32Array(mono.length)

  for (let i = 0; i < mono.length; i++) {
    left[i] = mono[i] * leftGain
    right[i] = mono[i] * rightGain
  }

  return [left, right]
}

/**
 * Decode WAV buffer to PCM samples.
 * Supports 16-bit, 24-bit, and 32-bit float PCM.
 */
function decodeWAV(wavBuffer: Buffer): { channels: Float32Array[]; sampleRate: number } {
  const view = new DataView(wavBuffer.buffer, wavBuffer.byteOffset, wavBuffer.byteLength)

  // Validate RIFF header
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  if (riff !== 'RIFF') throw new Error('Not a valid WAV file: missing RIFF header')

  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))
  if (wave !== 'WAVE') throw new Error('Not a valid WAV file: missing WAVE identifier')

  // Find fmt and data chunks
  let offset = 12
  let audioFormat = 0
  let numChannels = 0
  let sampleRate = 0
  let bitsPerSample = 0
  let dataOffset = 0
  let dataSize = 0

  while (offset < wavBuffer.length - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3)
    )
    const chunkSize = view.getUint32(offset + 4, true)

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(offset + 8, true)
      numChannels = view.getUint16(offset + 10, true)
      sampleRate = view.getUint32(offset + 12, true)
      bitsPerSample = view.getUint16(offset + 22, true)
    } else if (chunkId === 'data') {
      dataOffset = offset + 8
      dataSize = chunkSize
      break
    }

    offset += 8 + chunkSize
    if (chunkSize % 2 !== 0) offset++ // WAV chunks are word-aligned
  }

  if (dataOffset === 0) throw new Error('WAV file missing data chunk')
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`Unsupported WAV format: ${audioFormat} (only PCM=1 and IEEE float=3 supported)`)
  }

  const bytesPerSample = bitsPerSample / 8
  const totalSamples = Math.floor(dataSize / bytesPerSample)
  const samplesPerChannel = Math.floor(totalSamples / numChannels)

  console.log(`[Crossfade] WAV: ${numChannels}ch, ${sampleRate}Hz, ${bitsPerSample}-bit, ${samplesPerChannel} samples/ch`)

  const channels: Float32Array[] = Array.from({ length: numChannels }, () => new Float32Array(samplesPerChannel))

  let pos = dataOffset
  for (let i = 0; i < samplesPerChannel; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      if (audioFormat === 3 && bitsPerSample === 32) {
        // IEEE 32-bit float
        channels[ch][i] = view.getFloat32(pos, true)
      } else if (bitsPerSample === 16) {
        channels[ch][i] = view.getInt16(pos, true) / 32768
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(pos)
        const b1 = view.getUint8(pos + 1)
        const b2 = view.getUint8(pos + 2)
        const val = (b2 << 16) | (b1 << 8) | b0
        channels[ch][i] = (val > 0x7FFFFF ? val - 0x1000000 : val) / 8388608
      } else {
        throw new Error(`Unsupported bit depth: ${bitsPerSample}`)
      }
      pos += bytesPerSample
    }
  }

  return { channels, sampleRate }
}

/**
 * Detect audio format from buffer magic bytes and decode accordingly.
 * Supports MP3 and WAV.
 */
async function decodeAudio(buffer: Buffer): Promise<Float32Array[]> {
  // Check magic bytes: RIFF = WAV, 0xFF 0xFB/ID3 = MP3
  const isWAV = buffer.length > 4 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 &&
    buffer[2] === 0x46 && buffer[3] === 0x46 // "RIFF"

  if (isWAV) {
    console.log(`[Crossfade] Detected WAV format`)
    const { channels, sampleRate } = decodeWAV(buffer)

    // Ensure stereo
    let result = channels
    if (result.length === 1) {
      result = [result[0], new Float32Array(result[0])]
    }

    // Resample if needed
    if (sampleRate !== SAMPLE_RATE) {
      console.log(`[Crossfade] Resampling WAV from ${sampleRate} Hz to ${SAMPLE_RATE} Hz`)
      result = result.map(ch => resampleChannel(ch, sampleRate, SAMPLE_RATE))
    }

    return result
  }

  // Default: MP3
  return decodeMP3(buffer)
}

/**
 * Decode MP3 buffer to PCM samples
 * Returns channels resampled to SAMPLE_RATE if needed
 */
async function decodeMP3(mp3Buffer: Buffer): Promise<Float32Array[]> {
  const decoder = new MPEGDecoder()
  await decoder.ready

  const result = decoder.decode(new Uint8Array(mp3Buffer))
  const sourceSampleRate = result.sampleRate

  console.log(`[Crossfade] Decoded MP3: ${result.channelData.length} channels, ${sourceSampleRate} Hz, ${result.channelData[0]?.length} samples`)

  let channels: Float32Array[] = []

  for (let i = 0; i < result.channelData.length; i++) {
    channels.push(result.channelData[i])
  }

  decoder.free()

  // Ensure stereo
  if (channels.length === 1) {
    channels.push(new Float32Array(channels[0]))
  }

  // Resample if source sample rate differs from target
  if (sourceSampleRate !== SAMPLE_RATE) {
    console.log(`[Crossfade] Resampling from ${sourceSampleRate} Hz to ${SAMPLE_RATE} Hz`)
    channels = channels.map(channel => resampleChannel(channel, sourceSampleRate, SAMPLE_RATE))
  }

  return channels
}

/**
 * Simple linear resampling
 */
function resampleChannel(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate
  const outputLength = Math.floor(input.length / ratio)
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio
    const srcIndexFloor = Math.floor(srcIndex)
    const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1)
    const t = srcIndex - srcIndexFloor

    // Linear interpolation
    output[i] = input[srcIndexFloor] * (1 - t) + input[srcIndexCeil] * t
  }

  return output
}

/**
 * Encode PCM samples to MP3
 */
function encodeMP3(leftChannel: Float32Array, rightChannel: Float32Array): Buffer {
  const inputSamples = leftChannel.length
  const expectedRawBytes = inputSamples * 2 * 2 // stereo 16-bit
  console.log(`[Crossfade] MP3 encode input: ${inputSamples} samples (${(expectedRawBytes / 1024 / 1024).toFixed(1)} MB raw)`)

  console.log(`[Crossfade] Mp3Encoder type: ${typeof Mp3Encoder}`)
  if (typeof Mp3Encoder !== 'function') {
    throw new Error(`Mp3Encoder is not a function, got: ${typeof Mp3Encoder}`)
  }

  let mp3encoder: InstanceType<typeof Mp3Encoder>
  try {
    mp3encoder = new Mp3Encoder(CHANNELS, SAMPLE_RATE, BITRATE)
    console.log(`[Crossfade] Mp3Encoder created. encodeBuffer: ${typeof mp3encoder.encodeBuffer}, flush: ${typeof mp3encoder.flush}`)
  } catch (err) {
    console.error(`[Crossfade] Failed to create Mp3Encoder:`, err)
    throw new Error(`Mp3Encoder constructor failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  const left = new Int16Array(leftChannel.length)
  const right = new Int16Array(rightChannel.length)

  for (let i = 0; i < leftChannel.length; i++) {
    left[i] = Math.max(-32768, Math.min(32767, Math.round(leftChannel[i] * 32767)))
    right[i] = Math.max(-32768, Math.min(32767, Math.round(rightChannel[i] * 32767)))
  }

  const mp3Data: Uint8Array[] = []
  const blockSize = 1152
  let blocksProcessed = 0
  let totalEncodedBytes = 0

  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize)
    const rightChunk = right.subarray(i, i + blockSize)

    try {
      const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk)
      blocksProcessed++
      if (mp3buf && mp3buf.length > 0) {
        mp3Data.push(mp3buf)
        totalEncodedBytes += mp3buf.length
      }
    } catch (err) {
      console.error(`[Crossfade] encodeBuffer failed at block ${blocksProcessed}:`, err)
      throw new Error(`MP3 encoding failed at block ${blocksProcessed}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(`[Crossfade] Encoded ${blocksProcessed} blocks, ${mp3Data.length} chunks, ${totalEncodedBytes} bytes so far`)

  try {
    const final = mp3encoder.flush()
    if (final && final.length > 0) {
      mp3Data.push(final)
      totalEncodedBytes += final.length
      console.log(`[Crossfade] Flush added ${final.length} bytes`)
    }
  } catch (err) {
    console.error(`[Crossfade] flush() failed:`, err)
    throw new Error(`MP3 flush failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  const totalLength = mp3Data.reduce((acc, buf) => acc + buf.length, 0)
  console.log(`[Crossfade] Final MP3: ${totalLength} bytes (${(totalLength / 1024).toFixed(0)} KB)`)

  // Validate we got reasonable compression (MP3 should be ~10x smaller than raw PCM)
  const compressionRatio = expectedRawBytes / totalLength
  console.log(`[Crossfade] Compression ratio: ${compressionRatio.toFixed(1)}x (expected ~10x for 128kbps)`)

  if (totalLength === 0) {
    throw new Error('MP3 encoding produced 0 bytes - encoder may have failed silently')
  }

  if (compressionRatio < 2) {
    console.error(`[Crossfade] WARNING: Compression ratio too low (${compressionRatio.toFixed(1)}x). Output may not be valid MP3!`)
    throw new Error(`MP3 encoding failed - output is ${totalLength} bytes but should be ~${Math.floor(expectedRawBytes / 10)} bytes. Compression ratio: ${compressionRatio.toFixed(1)}x`)
  }

  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const buf of mp3Data) {
    result.set(buf, offset)
    offset += buf.length
  }

  // Verify MP3 header (should start with ID3 tag or MP3 sync word 0xFF 0xFB/0xFA/0xF3/0xF2)
  const header = result.slice(0, 4)
  const isID3 = header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33 // "ID3"
  const isMP3Frame = header[0] === 0xFF && (header[1] & 0xE0) === 0xE0 // MP3 sync word

  console.log(`[Crossfade] MP3 header: ${Array.from(header).map(b => b.toString(16).padStart(2, '0')).join(' ')} (ID3: ${isID3}, MP3Frame: ${isMP3Frame})`)

  if (!isID3 && !isMP3Frame) {
    throw new Error(`Invalid MP3 output - header bytes ${Array.from(header).map(b => b.toString(16)).join(' ')} don't match MP3 format`)
  }

  return Buffer.from(result)
}

/**
 * Detect silence at the end of an audio segment
 * Returns duration of trailing silence in milliseconds
 */
function detectTrailingSilence(pcm: Float32Array[], thresholdDb: number = -40): number {
  const threshold = Math.pow(10, thresholdDb / 20) // Convert dB to linear
  const channel = pcm[0]

  let silentSamples = 0

  // Scan from end backwards
  for (let i = channel.length - 1; i >= 0; i--) {
    if (Math.abs(channel[i]) > threshold) {
      break
    }
    silentSamples++
  }

  return (silentSamples / SAMPLE_RATE) * 1000
}

function detectLeadingSilence(pcm: Float32Array[], thresholdDb: number = -40): number {
  const threshold = Math.pow(10, thresholdDb / 20)
  const channel = pcm[0]

  let silentSamples = 0

  for (let i = 0; i < channel.length; i++) {
    if (Math.abs(channel[i]) > threshold) {
      break
    }
    silentSamples++
  }

  return (silentSamples / SAMPLE_RATE) * 1000
}

function trimLeadingSilence(pcm: Float32Array[], silenceMs: number, keepMs: number = 10): Float32Array[] {
  const trimMs = Math.max(0, silenceMs - keepMs)
  const samplesToTrim = Math.floor((trimMs / 1000) * SAMPLE_RATE)

  if (samplesToTrim <= 0 || samplesToTrim >= pcm[0].length) {
    return pcm
  }

  return pcm.map(ch => ch.slice(samplesToTrim))
}

/**
 * Analyze a segment's text to determine dialogue patterns
 */
function analyzeText(text: string): {
  wordCount: number
  isShortReaction: boolean
  isInterrupting: boolean
  isQuestion: boolean
  endsWithTrailOff: boolean
} {
  // Strip emotion tags for analysis
  const cleanText = text
    .replace(/\[(?:cheerfully|thoughtfully|seriously|excitedly|skeptically|laughing|sighing|whispering|interrupting|curiously|dramatically|calmly|enthusiastically)\]\s*/gi, '')
    .trim()

  const words = cleanText.split(/\s+/).filter(w => w.length > 0)
  const wordCount = words.length

  // Check for interrupting tag
  const isInterrupting = /\[interrupting\]/i.test(text)

  // Check for short reactions (1-3 words)
  const isShortReaction = wordCount <= 3 &&
    SHORT_REACTIONS.has(cleanText.toLowerCase().replace(/[!?.,]+$/, ''))

  // Check if it's a question
  const isQuestion = cleanText.endsWith('?')

  // Check if text trails off (ends with ...)
  const endsWithTrailOff = cleanText.endsWith('...')

  return { wordCount, isShortReaction, isInterrupting, isQuestion, endsWithTrailOff }
}

/**
 * Calculate optimal overlap duration between two segments
 */
interface OverlapSettings {
  reactionMs: number
  interruptMs: number
  questionMs: number
  speakerChangeMs: number
  overlappingMs: number
}

function calculateOverlap(
  current: AnalyzedSegment,
  next: AnalyzedSegment,
  overlapOpts?: OverlapSettings
): number {
  const reactionMs = overlapOpts?.reactionMs ?? DEFAULT_OVERLAP_SHORT_REACTION
  const interruptMs = overlapOpts?.interruptMs ?? DEFAULT_OVERLAP_INTERRUPTING
  const questionMs = overlapOpts?.questionMs ?? DEFAULT_OVERLAP_AFTER_QUESTION
  const speakerChangeMs = overlapOpts?.speakerChangeMs ?? DEFAULT_OVERLAP_SPEAKER_CHANGE
  const overlappingMs = overlapOpts?.overlappingMs ?? 500

  const currentDurationMs = (current.pcm[0].length / SAMPLE_RATE) * 1000
  const nextDurationMs = (next.pcm[0].length / SAMPLE_RATE) * 1000

  // Priority 0: Explicit (overlapping) annotation — TRUE simultaneous speech
  // Uses the configured overlappingMs from the Audio Mixer slider.
  if (next.isOverlapping) {
    const overlapMs = Math.min(overlappingMs, currentDurationMs * 0.4, nextDurationMs * 0.95)
    console.log(`[Crossfade] Overlapping: "${next.text.substring(0, 40)}..." → ${overlapMs.toFixed(0)}ms (slider=${overlappingMs}ms)`)
    return overlapMs
  }

  // Don't overlap very short segments (except explicit overlapping above)
  if (currentDurationMs < MIN_SEGMENT_FOR_OVERLAP || nextDurationMs < MIN_SEGMENT_FOR_OVERLAP) {
    return 0
  }

  // Same speaker continues - add small gap instead of overlap
  if (current.speaker === next.speaker) {
    return OVERLAP_SAME_SPEAKER
  }

  // Priority 1: Short reactions get heavy overlap
  if (next.isShortReaction) {
    console.log(`[Crossfade] Short reaction detected: "${next.text.substring(0, 30)}..."`)
    return Math.min(reactionMs, currentDurationMs * 0.3, nextDurationMs * 0.5)
  }

  // Priority 2: Explicit interrupting tag
  if (next.isInterrupting) {
    console.log(`[Crossfade] Interrupting tag detected`)
    return Math.min(interruptMs, currentDurationMs * 0.25)
  }

  // Priority 3: Quick answer after question
  if (current.isQuestion) {
    return Math.min(questionMs, currentDurationMs * 0.1)
  }

  // Priority 4: Trail-off suggests natural interruption point
  if (current.endsWithTrailOff) {
    return Math.min(interruptMs, currentDurationMs * 0.2)
  }

  // Default: Normal speaker change with light overlap
  return Math.min(speakerChangeMs, currentDurationMs * 0.05)
}

/**
 * Trim detected silence from end of audio
 */
function trimSilence(pcm: Float32Array[], silenceMs: number, keepMs: number = 30): Float32Array[] {
  const trimMs = Math.max(0, silenceMs - keepMs) // Keep a tiny bit of natural silence
  const samplesToTrim = Math.floor((trimMs / 1000) * SAMPLE_RATE)

  if (samplesToTrim <= 0 || samplesToTrim >= pcm[0].length) {
    return pcm
  }

  return pcm.map(ch => ch.slice(0, ch.length - samplesToTrim))
}

/**
 * Apply crossfade with exponential curve for more natural sound
 */
function applyCrossfade(
  endOfFirst: Float32Array[],
  startOfSecond: Float32Array[],
  fadeLength: number
): Float32Array[] {
  const result: Float32Array[] = [
    new Float32Array(fadeLength),
    new Float32Array(fadeLength)
  ]

  for (let i = 0; i < fadeLength; i++) {
    const t = i / fadeLength

    // Exponential curves for more natural crossfade
    // First segment fades out slowly then quickly
    const fadeOut = Math.pow(1 - t, 1.5)
    // Second segment fades in quickly then slowly
    const fadeIn = Math.pow(t, 0.8)

    // Normalize to prevent clipping
    const total = fadeOut + fadeIn
    const normFadeOut = fadeOut / Math.max(total, 1)
    const normFadeIn = fadeIn / Math.max(total, 1)

    for (let ch = 0; ch < 2; ch++) {
      result[ch][i] = (endOfFirst[ch][i] * normFadeOut) + (startOfSecond[ch][i] * normFadeIn)
    }
  }

  return result
}

/**
 * Apply additive overlap — both speakers at full volume simultaneously.
 * Unlike crossfade (one fades out, other fades in), both voices remain audible.
 * Uses soft-limiter (tanh) to prevent clipping when signals stack.
 * Short fade-in/out (15%) smooths the edges of the overlap region.
 */
function applyAdditiveOverlap(
  endOfFirst: Float32Array[],
  startOfSecond: Float32Array[],
  overlapLength: number
): Float32Array[] {
  const result: Float32Array[] = [
    new Float32Array(overlapLength),
    new Float32Array(overlapLength)
  ]

  for (let i = 0; i < overlapLength; i++) {
    // Gentle fade-in/out at edges (15% of overlap) for natural blending
    const fadeIn = Math.min(1, i / (overlapLength * 0.15))
    const fadeOut = Math.min(1, (overlapLength - i) / (overlapLength * 0.15))

    for (let ch = 0; ch < 2; ch++) {
      const mixed = (endOfFirst[ch][i] * fadeOut) + (startOfSecond[ch][i] * fadeIn)
      // Soft-limiter: linear below 0.8, tanh saturation above
      result[ch][i] = Math.abs(mixed) < 0.8 ? mixed : Math.tanh(mixed * 1.2) / Math.tanh(1.2)
    }
  }

  return result
}

/**
 * Load the podcast intro audio file (MP3 or WAV)
 */
async function loadIntro(url?: string): Promise<Float32Array[]> {
  const introUrl = url || `${getBaseUrl()}/audio/podcast-intro.mp3`

  try {
    console.log(`[Crossfade] Fetching intro from ${introUrl}`)
    const response = await fetch(introUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch intro: ${response.status}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    console.log(`[Crossfade] Intro fetched: ${arrayBuffer.byteLength} bytes`)
    const pcm = await decodeAudio(Buffer.from(arrayBuffer))
    const maxVal = Math.max(...pcm[0].slice(0, 10000).map(Math.abs))
    console.log(`[Crossfade] Loaded intro: ${(pcm[0].length / SAMPLE_RATE).toFixed(1)}s, max amplitude: ${maxVal.toFixed(4)}`)
    return pcm
  } catch (err) {
    console.error(`[Crossfade] Failed to load intro from ${introUrl}:`, err)
    throw err
  }
}

/**
 * Apply intro with crossfade to first segment
 *
 * Three phases:
 * 1. Intro at full volume, no dialog (3s)
 * 2. Intro drops to 20% as bed music, dialog fades in over 1s then plays full (7s)
 * 3. Intro fades from 20% to 0% while dialog continues (3s)
 *
 * Total intro presence: 13s
 */
interface IntroOptions {
  fullSec: number
  bedSec: number
  bedVolume: number
  fadeoutSec: number
  dialogFadeInSec: number
  fadeoutCurve: 'linear' | 'exponential'
  dialogCurve: 'linear' | 'exponential'
}

function applyIntroWithCrossfade(
  intro: Float32Array[],
  firstSegment: Float32Array[],
  opts: IntroOptions
): Float32Array[] {
  const introLength = intro[0].length
  const segmentLength = firstSegment[0].length

  // Phase 1: Intro at full volume, no dialog
  const phase1Sec = opts.fullSec
  // Phase 2: Intro at bed volume, dialog plays
  const phase2Sec = opts.bedSec
  // Phase 3: Intro fades from bed volume to 0%, dialog continues
  const phase3Sec = opts.fadeoutSec
  // How quickly dialog fades in at start of phase 2
  const dialogFadeInSec = opts.dialogFadeInSec
  // Bed volume (0–1)
  const bedVol = opts.bedVolume

  const phase1Samples = Math.floor(phase1Sec * SAMPLE_RATE)
  const phase2Samples = Math.floor(phase2Sec * SAMPLE_RATE)
  const phase3Samples = Math.floor(phase3Sec * SAMPLE_RATE)
  const dialogFadeInSamples = Math.floor(dialogFadeInSec * SAMPLE_RATE)
  const introTotalSamples = phase1Samples + phase2Samples + phase3Samples

  // Ensure intro is long enough, otherwise use what we have
  const introUsable = Math.min(introLength, introTotalSamples)
  const phase1End = Math.min(phase1Samples, introUsable)

  // Dialog starts at phase 2
  const dialogDuration = phase2Samples + phase3Samples + Math.max(0, segmentLength - phase2Samples - phase3Samples)

  // Total length: phase 1 (intro only) + max(dialog length, phase2 + phase3)
  const totalLength = phase1End + Math.max(phase2Samples + phase3Samples, segmentLength)

  const result: Float32Array[] = [
    new Float32Array(totalLength),
    new Float32Array(totalLength)
  ]

  // Phase 1: Intro at full volume (0 → 3s, no dialog)
  for (let ch = 0; ch < 2; ch++) {
    result[ch].set(intro[ch].slice(0, phase1End), 0)
  }

  // Phase 2: Intro at 20% bed + dialog fades in then full (3s → 10s)
  for (let i = 0; i < phase2Samples; i++) {
    const introIdx = phase1End + i
    const introVal = introIdx < introLength ? bedVol : 0

    // Dialog fades in over first 1s of phase 2, then stays at full
    let dialogGain: number
    if (i < dialogFadeInSamples) {
      dialogGain = opts.dialogCurve === 'linear'
        ? (i / dialogFadeInSamples)
        : Math.pow(i / dialogFadeInSamples, 0.7)
    } else {
      dialogGain = 1.0
    }

    for (let ch = 0; ch < 2; ch++) {
      const iVal = introIdx < introLength ? intro[ch][introIdx] * introVal : 0
      const dVal = i < segmentLength ? firstSegment[ch][i] * dialogGain : 0
      // Clamp
      const combined = Math.abs(iVal) + Math.abs(dVal)
      const scale = combined > 1.0 ? 1.0 / combined : 1.0
      result[ch][phase1End + i] = (iVal + dVal) * scale
    }
  }

  // Phase 3: Intro fades from 20% → 0%, dialog at full (10s → 13s)
  for (let i = 0; i < phase3Samples; i++) {
    const ft = i / phase3Samples
    const introIdx = phase1End + phase2Samples + i
    const introGain = opts.fadeoutCurve === 'linear'
      ? bedVol * (1 - ft)
      : bedVol * (1 - Math.pow(ft, 1.5))

    const segIdx = phase2Samples + i

    for (let ch = 0; ch < 2; ch++) {
      const iVal = introIdx < introLength ? intro[ch][introIdx] * introGain : 0
      const dVal = segIdx < segmentLength ? firstSegment[ch][segIdx] : 0
      const combined = Math.abs(iVal) + Math.abs(dVal)
      const scale = combined > 1.0 ? 1.0 / combined : 1.0
      result[ch][phase1End + phase2Samples + i] = (iVal + dVal) * scale
    }
  }

  // Phase 4: Remaining dialog after all intro phases
  const dialogConsumed = phase2Samples + phase3Samples
  if (segmentLength > dialogConsumed) {
    for (let ch = 0; ch < 2; ch++) {
      result[ch].set(
        firstSegment[ch].slice(dialogConsumed),
        phase1End + dialogConsumed
      )
    }
  }

  const maxVal = Math.max(...result[0].slice(0, 50000).map(Math.abs))
  console.log(`[Crossfade] Applied intro: ${phase1Sec}s full + ${phase2Sec}s bed@${Math.round(bedVol * 100)}% + ${phase3Sec}s fadeout. Result: ${(totalLength / SAMPLE_RATE).toFixed(1)}s, max amplitude: ${maxVal.toFixed(4)}`)

  return result
}

/**
 * Apply intro using envelope curves for music and dialog gain.
 * Each sample's gain is determined by sampling the envelope at that time position.
 */
function applyIntroWithEnvelope(
  intro: Float32Array[],
  firstSegment: Float32Array[],
  musicEnv: AudioEnvelope,
  dialogEnv: AudioEnvelope,
): Float32Array[] {
  const introLength = intro[0].length
  const segmentLength = firstSegment[0].length

  // Determine total intro duration from envelope end time
  const musicEnd = musicEnv.points[musicEnv.points.length - 1].sec
  const dialogEnd = dialogEnv.points[dialogEnv.points.length - 1].sec
  const introTotalSec = Math.max(musicEnd, dialogEnd)
  const introTotalSamples = Math.ceil(introTotalSec * SAMPLE_RATE)

  // Music plays from 0 to introTotalSamples
  // Dialog starts at t=0 of the envelope but is overlaid with intro music
  // After intro finishes, remaining dialog continues

  // Find where dialog gain first reaches 1.0 (full volume) to know dialog start offset
  // Dialog in envelope starts at its own t=0 which corresponds to the start of the intro
  const totalLength = Math.max(introTotalSamples, introTotalSamples - 0 + segmentLength)

  const result: Float32Array[] = [
    new Float32Array(totalLength),
    new Float32Array(totalLength),
  ]

  // Find where dialog should start playing (where dialog envelope first goes above 0)
  let dialogStartSample = 0
  for (let i = 0; i < introTotalSamples; i++) {
    const t = i / SAMPLE_RATE
    if (sampleEnvelope(dialogEnv, t) > 0.001) {
      dialogStartSample = i
      break
    }
  }

  // Mix intro music + dialog for the intro duration
  for (let i = 0; i < introTotalSamples; i++) {
    const timeSec = i / SAMPLE_RATE
    const musicGain = sampleEnvelope(musicEnv, timeSec)
    const dialogGain = sampleEnvelope(dialogEnv, timeSec)

    // Dialog PCM index: offset so dialog starts playing when envelope says so
    const dialogIdx = i - dialogStartSample

    for (let ch = 0; ch < 2; ch++) {
      const mVal = i < introLength ? intro[ch][i] * musicGain : 0
      const dVal = dialogIdx >= 0 && dialogIdx < segmentLength ? firstSegment[ch][dialogIdx] * dialogGain : 0
      const combined = Math.abs(mVal) + Math.abs(dVal)
      const scale = combined > 1.0 ? 1.0 / combined : 1.0
      result[ch][i] = (mVal + dVal) * scale
    }
  }

  // Remaining dialog after intro ends
  const dialogConsumed = introTotalSamples - dialogStartSample
  if (segmentLength > dialogConsumed) {
    for (let ch = 0; ch < 2; ch++) {
      const remaining = firstSegment[ch].slice(dialogConsumed)
      result[ch].set(remaining, introTotalSamples)
    }
  }

  // Trim to actual content length
  const actualLength = introTotalSamples + Math.max(0, segmentLength - dialogConsumed)
  const trimmed: Float32Array[] = [
    result[0].slice(0, actualLength),
    result[1].slice(0, actualLength),
  ]

  console.log(`[Crossfade] Applied intro with envelope: ${introTotalSec.toFixed(1)}s intro, dialog starts at ${(dialogStartSample / SAMPLE_RATE).toFixed(1)}s. Result: ${(actualLength / SAMPLE_RATE).toFixed(1)}s`)

  return trimmed
}

/**
 * Apply outro using envelope curves for music and dialog gain.
 */
function applyOutroWithEnvelope(
  podcast: Float32Array[],
  outro: Float32Array[],
  musicEnv: AudioEnvelope,
  dialogEnv: AudioEnvelope,
): Float32Array[] {
  const podcastLength = podcast[0].length
  const outroLength = outro[0].length

  // Envelope duration determines crossfade length
  const musicEnd = musicEnv.points[musicEnv.points.length - 1].sec
  const dialogEnd = dialogEnv.points[dialogEnv.points.length - 1].sec
  const crossfadeSec = Math.max(musicEnd, dialogEnd)
  const crossfadeSamples = Math.ceil(crossfadeSec * SAMPLE_RATE)

  // Point where crossfade starts
  const crossfadeStart = Math.max(0, podcastLength - crossfadeSamples)

  // Total: podcast up to crossfade + crossfade + remaining outro
  const totalLength = crossfadeStart + crossfadeSamples + Math.max(0, outroLength - crossfadeSamples)

  const result: Float32Array[] = [
    new Float32Array(totalLength),
    new Float32Array(totalLength),
  ]

  // Copy podcast up to crossfade
  for (let ch = 0; ch < 2; ch++) {
    result[ch].set(podcast[ch].slice(0, crossfadeStart), 0)
  }

  // Apply crossfade region with envelope-controlled gains
  for (let i = 0; i < crossfadeSamples; i++) {
    const timeSec = i / SAMPLE_RATE
    const outroGain = sampleEnvelope(musicEnv, timeSec)
    const dialogGain = sampleEnvelope(dialogEnv, timeSec)

    const combined = outroGain + dialogGain
    const scale = combined > 1.0 ? 1.0 / combined : 1.0

    for (let ch = 0; ch < 2; ch++) {
      const podcastVal = crossfadeStart + i < podcastLength ? podcast[ch][crossfadeStart + i] * dialogGain : 0
      const outroVal = i < outroLength ? outro[ch][i] * outroGain : 0
      result[ch][crossfadeStart + i] = (podcastVal + outroVal) * scale
    }
  }

  // Add remaining outro after crossfade
  if (outroLength > crossfadeSamples) {
    for (let ch = 0; ch < 2; ch++) {
      result[ch].set(
        outro[ch].slice(crossfadeSamples),
        crossfadeStart + crossfadeSamples,
      )
    }
  }

  console.log(`[Crossfade] Applied outro with envelope: ${crossfadeSec.toFixed(1)}s crossfade. Result: ${(totalLength / SAMPLE_RATE).toFixed(1)}s`)

  return result
}

/**
 * Load the podcast outro audio file (MP3 or WAV)
 */
async function loadOutro(url?: string): Promise<Float32Array[]> {
  const outroUrl = url || `${getBaseUrl()}/audio/podcast-outro.mp3`

  try {
    console.log(`[Crossfade] Fetching outro from ${outroUrl}`)
    const response = await fetch(outroUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch outro: ${response.status}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    console.log(`[Crossfade] Outro fetched: ${arrayBuffer.byteLength} bytes`)
    const pcm = await decodeAudio(Buffer.from(arrayBuffer))
    const maxVal = Math.max(...pcm[0].slice(0, 10000).map(Math.abs))
    console.log(`[Crossfade] Loaded outro: ${(pcm[0].length / SAMPLE_RATE).toFixed(1)}s, max amplitude: ${maxVal.toFixed(4)}`)
    return pcm
  } catch (err) {
    console.error(`[Crossfade] Failed to load outro from ${outroUrl}:`, err)
    throw err
  }
}

/**
 * Apply outro with crossfade after last segment
 * During the last N seconds of the podcast, outro fades in while speech fades out
 * Then outro continues playing fully
 */
interface OutroOptions {
  crossfadeSec: number
  riseSec: number
  bedVolume: number
  finalStartSec: number
  riseCurve: 'linear' | 'exponential'
  finalCurve: 'linear' | 'exponential'
}

function applyOutroWithCrossfade(
  podcast: Float32Array[],
  outro: Float32Array[],
  opts: OutroOptions
): Float32Array[] {
  const crossfadeSamples = Math.floor(opts.crossfadeSec * SAMPLE_RATE)
  const podcastLength = podcast[0].length
  const outroLength = outro[0].length

  const outroRiseSamples = Math.floor(opts.riseSec * SAMPLE_RATE)
  const outroFinalStartSamples = Math.floor(opts.finalStartSec * SAMPLE_RATE)
  const outroFinalSamples = crossfadeSamples - outroFinalStartSamples
  const bedVol = opts.bedVolume

  // Point where crossfade starts (end of podcast minus crossfade duration)
  const crossfadeStart = Math.max(0, podcastLength - crossfadeSamples)

  // Total length: podcast up to crossfade + crossfade region + rest of outro
  const totalLength = crossfadeStart + crossfadeSamples + Math.max(0, outroLength - crossfadeSamples)

  const result: Float32Array[] = [
    new Float32Array(totalLength),
    new Float32Array(totalLength)
  ]

  // Copy podcast up to crossfade start
  for (let ch = 0; ch < 2; ch++) {
    result[ch].set(podcast[ch].slice(0, crossfadeStart), 0)
  }

  // Apply crossfade region
  for (let i = 0; i < crossfadeSamples; i++) {
    const t = i / crossfadeSamples

    let outroFade: number
    if (i < outroRiseSamples) {
      const rt = i / outroRiseSamples
      outroFade = opts.riseCurve === 'linear'
        ? bedVol * rt
        : bedVol * Math.pow(rt, 1.5)
    } else if (i < outroFinalStartSamples) {
      outroFade = bedVol
    } else {
      const ft = (i - outroFinalStartSamples) / outroFinalSamples
      outroFade = opts.finalCurve === 'linear'
        ? bedVol + (1 - bedVol) * ft
        : bedVol + (1 - bedVol) * Math.pow(ft, 2.0)
    }

    // Dialog stays at full volume throughout
    const podcastFade = 1.0

    // Clamp combined volume to prevent clipping
    const combined = podcastFade + outroFade
    const scale = combined > 1.0 ? 1.0 / combined : 1.0

    for (let ch = 0; ch < 2; ch++) {
      const podcastVal = crossfadeStart + i < podcastLength ? podcast[ch][crossfadeStart + i] : 0
      const outroVal = i < outroLength ? outro[ch][i] : 0
      result[ch][crossfadeStart + i] = (podcastVal * podcastFade + outroVal * outroFade) * scale
    }
  }

  // Add remaining outro after crossfade
  if (outroLength > crossfadeSamples) {
    for (let ch = 0; ch < 2; ch++) {
      result[ch].set(
        outro[ch].slice(crossfadeSamples),
        crossfadeStart + crossfadeSamples
      )
    }
  }

  const maxValStart = Math.max(...result[0].slice(0, 50000).map(Math.abs))
  const maxValEnd = Math.max(...result[0].slice(-50000).map(Math.abs))
  console.log(`[Crossfade] Applied outro with ${opts.crossfadeSec}s transition (rise ${opts.riseSec}s, bed@${Math.round(bedVol * 100)}%, final@${opts.finalStartSec}s). Result: ${(totalLength / SAMPLE_RATE).toFixed(1)}s, start amp: ${maxValStart.toFixed(4)}, end amp: ${maxValEnd.toFixed(4)}`)

  return result
}

/**
 * Fast-path concatenation for large podcasts (40+ segments).
 * Only decodes segments needed for intro/outro mixing.
 * Middle segments are concatenated as raw MP3 buffers — no decode, no encode.
 * This keeps peak memory under ~50 MB instead of 600+ MB.
 */
async function concatenateLargeScale(
  segments: AudioSegment[],
  options: CrossfadeOptions
): Promise<Buffer> {
  const {
    includeIntro = false,
    includeOutro = false,
    introFullSec = 3,
    introBedSec = 7,
    introBedVolume = 0.20,
    introFadeoutSec = 3,
    introDialogFadeInSec = 1,
    introFadeoutCurve = 'exponential',
    introDialogCurve = 'exponential',
    outroCrossfadeSec = 10,
    outroRiseSec = 3,
    outroBedVolume = 0.20,
    outroFinalStartSec = 7,
    outroRiseCurve = 'exponential',
    outroFinalCurve = 'exponential',
    stereoHost = DEFAULT_STEREO_HOST,
    stereoGuest = DEFAULT_STEREO_GUEST,
    overlapOverlappingMs = 500,
    introUrl,
    outroUrl,
  } = options

  const stereoPositions = { HOST: stereoHost, GUEST: stereoGuest }
  const overlapSamplesFromSlider = Math.floor((overlapOverlappingMs / 1000) * SAMPLE_RATE)

  console.log(`[Crossfade] Large-scale mode: ${segments.length} segments (threshold: ${LARGE_PODCAST_THRESHOLD}, overlapping: ${overlapOverlappingMs}ms)`)

  const mp3Parts: Buffer[] = []
  let introSegments = 0
  let outroSegments = 0
  let totalOverlapMs = 0

  // 1. Handle intro: decode first segment + intro music → mix → encode to MP3
  if (includeIntro) {
    console.log(`[Crossfade] Loading and mixing intro with first segment...`)
    const intro = await loadIntro(introUrl)
    const firstPcm = await decodeMP3(segments[0].buffer)
    const firstStereo = applyStereoPosition(firstPcm, segments[0].speaker, stereoPositions)

    let introResult: Float32Array[]
    if (options.introMusicEnvelope && options.introDialogEnvelope) {
      introResult = applyIntroWithEnvelope(intro, firstStereo,
        options.introMusicEnvelope, options.introDialogEnvelope)
    } else {
      introResult = applyIntroWithCrossfade(intro, firstStereo, {
        fullSec: introFullSec,
        bedSec: introBedSec,
        bedVolume: introBedVolume,
        fadeoutSec: introFadeoutSec,
        dialogFadeInSec: introDialogFadeInSec,
        fadeoutCurve: introFadeoutCurve as 'linear' | 'exponential',
        dialogCurve: introDialogCurve as 'linear' | 'exponential',
      })
    }

    mp3Parts.push(encodeMP3(introResult[0], introResult[1]))
    introSegments = 1
    console.log(`[Crossfade] Intro mixed with first segment ✓`)
  }

  // 2. Determine how many trailing segments are needed for outro mixing
  if (includeOutro && segments.length > introSegments) {
    // Need enough audio for the outro crossfade (default 10s)
    // Estimate ~15s avg per segment → typically 1 segment suffices
    outroSegments = Math.min(2, segments.length - introSegments)
  }

  // 3. Middle segments: decode → stereo pan → re-encode one at a time
  //    This keeps peak memory at ~13 MB (one segment) instead of 600+ MB (all segments).
  //    Raw MP3 concat doesn't work because each segment has its own MP3/ID3 headers.
  //    For overlapping segments: keep previous PCM in memory to mix additively.
  const middleStart = introSegments
  const middleEnd = segments.length - outroSegments

  if (middleEnd > middleStart) {
    const middleCount = middleEnd - middleStart
    // Total steps: middleCount + intro(1) + outro(1) for progress calculation
    const totalSteps = middleCount + (introSegments > 0 ? 1 : 0) + (outroSegments > 0 ? 1 : 0)
    const introSteps = introSegments > 0 ? 1 : 0
    console.log(`[Crossfade] Re-encoding segments ${middleStart + 1}–${middleEnd} individually (${middleCount} segments, stereo pan)`)

    // Track previous segment PCM for overlapping mixing
    let prevStereo: Float32Array[] | null = null

    for (let i = middleStart; i < middleEnd; i++) {
      let pcm = await decodeMP3(segments[i].buffer)

      // Trim leading silence for overlapping segments
      if (segments[i].overlapping) {
        const leadSilence = detectLeadingSilence(pcm)
        if (leadSilence > 20) {
          pcm = trimLeadingSilence(pcm, leadSilence)
        }
      }

      const stereo = applyStereoPosition(pcm, segments[i].speaker, stereoPositions)

      if (segments[i].overlapping && prevStereo) {
        // Additive overlap: use slider value, capped by segment lengths
        const overlapSamples = Math.min(
          overlapSamplesFromSlider,
          stereo[0].length,
          Math.floor(prevStereo[0].length * 0.4)
        )

        if (overlapSamples > 0) {
          const overlapMs = (overlapSamples / SAMPLE_RATE) * 1000
          totalOverlapMs += overlapMs
          console.log(`[Crossfade] Large-scale overlapping: "${segments[i].text.substring(0, 40)}..." → ${overlapMs.toFixed(0)}ms (slider=${overlapOverlappingMs}ms, total=${totalOverlapMs.toFixed(0)}ms)`)

          // Extract tail of previous and start of current
          const prevTail: Float32Array[] = [
            prevStereo[0].slice(prevStereo[0].length - overlapSamples),
            prevStereo[1].slice(prevStereo[1].length - overlapSamples),
          ]
          const currStart: Float32Array[] = [
            stereo[0].slice(0, overlapSamples),
            stereo[1].slice(0, overlapSamples),
          ]

          // Mix additively
          const mixed = applyAdditiveOverlap(prevTail, currStart, overlapSamples)

          // Rebuild previous: trim tail, append mixed region
          const prevTrimLen = prevStereo[0].length - overlapSamples
          const prevRebuilt: Float32Array[] = [
            new Float32Array(prevTrimLen + overlapSamples),
            new Float32Array(prevTrimLen + overlapSamples),
          ]
          for (let ch = 0; ch < 2; ch++) {
            prevRebuilt[ch].set(prevStereo[ch].subarray(0, prevTrimLen), 0)
            prevRebuilt[ch].set(mixed[ch], prevTrimLen)
          }

          // Encode and push the rebuilt previous segment
          mp3Parts.push(encodeMP3(prevRebuilt[0], prevRebuilt[1]))

          // Current segment continues after the overlap region
          if (stereo[0].length > overlapSamples) {
            const remainder: Float32Array[] = [
              stereo[0].slice(overlapSamples),
              stereo[1].slice(overlapSamples),
            ]
            prevStereo = remainder
          } else {
            prevStereo = null
          }
        } else {
          // Overlap too small, just encode previous normally
          mp3Parts.push(encodeMP3(prevStereo[0], prevStereo[1]))
          prevStereo = stereo
        }
      } else {
        // Normal segment: encode previous if pending, keep current for potential next overlap
        if (prevStereo) {
          mp3Parts.push(encodeMP3(prevStereo[0], prevStereo[1]))
        }
        prevStereo = stereo
      }

      const done = i - middleStart + 1
      if (done % 20 === 0 || i === middleEnd - 1) {
        console.log(`[Crossfade] Progress: ${done}/${middleCount} segments re-encoded`)
      }
      // Report progress: intro=done, middle segments progressing, outro=pending
      if (options.onProgress) {
        const percent = Math.round(((introSteps + done) / totalSteps) * 100)
        await options.onProgress(percent)
      }
    }

    // Flush last pending segment
    if (prevStereo) {
      mp3Parts.push(encodeMP3(prevStereo[0], prevStereo[1]))
      prevStereo = null
    }
  }

  // 4. Handle outro: decode last N segments + outro music → mix → encode to MP3
  //    Shift outro crossfade start earlier by accumulated overlap time so the
  //    outro doesn't start too late when middle segments had overlapping speech.
  if (outroSegments > 0) {
    const overlapShiftSec = totalOverlapMs / 1000
    console.log(`[Crossfade] Loading and mixing outro with last ${outroSegments} segments (overlap shift: ${overlapShiftSec.toFixed(1)}s)...`)
    const outro = await loadOutro(outroUrl)

    // Decode and concatenate the last N segments into one PCM buffer
    const lastSegmentPcms: Float32Array[][] = []
    for (let i = segments.length - outroSegments; i < segments.length; i++) {
      const pcm = await decodeMP3(segments[i].buffer)
      const stereo = applyStereoPosition(pcm, segments[i].speaker, stereoPositions)
      lastSegmentPcms.push(stereo)
    }

    const totalLength = lastSegmentPcms.reduce((sum, pcm) => sum + pcm[0].length, 0)
    const combinedLast: Float32Array[] = [
      new Float32Array(totalLength),
      new Float32Array(totalLength),
    ]
    let writeOffset = 0
    for (const pcm of lastSegmentPcms) {
      combinedLast[0].set(pcm[0], writeOffset)
      combinedLast[1].set(pcm[1], writeOffset)
      writeOffset += pcm[0].length
    }

    // Apply outro crossfade — increase crossfade duration by accumulated overlap
    // so the outro music starts earlier to compensate for shorter middle section
    const adjustedOutroCrossfadeSec = outroCrossfadeSec + overlapShiftSec
    let outroResult: Float32Array[]
    if (options.outroMusicEnvelope && options.outroDialogEnvelope) {
      outroResult = applyOutroWithEnvelope(combinedLast, outro,
        options.outroMusicEnvelope, options.outroDialogEnvelope)
    } else {
      outroResult = applyOutroWithCrossfade(combinedLast, outro, {
        crossfadeSec: adjustedOutroCrossfadeSec,
        riseSec: outroRiseSec,
        bedVolume: outroBedVolume,
        finalStartSec: outroFinalStartSec,
        riseCurve: outroRiseCurve as 'linear' | 'exponential',
        finalCurve: outroFinalCurve as 'linear' | 'exponential',
      })
    }

    mp3Parts.push(encodeMP3(outroResult[0], outroResult[1]))
    console.log(`[Crossfade] Outro mixed ✓`)
  }

  // 5. Combine all MP3 parts
  const result = Buffer.concat(mp3Parts)
  console.log(`[Crossfade] Large-scale concatenation complete: ${(result.length / 1024).toFixed(0)} KB`)

  return result
}

/**
 * Concatenate audio segments with smart crossfade
 */
export async function concatenateWithCrossfade(
  segments: AudioSegment[],
  options: CrossfadeOptions = {}
): Promise<Buffer> {
  const {
    includeIntro = false,
    includeOutro = false,
    // Intro settings
    introFullSec = 3,
    introBedSec = 7,
    introBedVolume = 0.20,
    introFadeoutSec = 3,
    introDialogFadeInSec = 1,
    introFadeoutCurve = 'exponential',
    introDialogCurve = 'exponential',
    // Outro settings
    outroCrossfadeSec = 10,
    outroRiseSec: _outroRiseSec = 3,
    outroBedVolume = 0.20,
    outroFinalStartSec: _outroFinalStartSec = 7,
    outroRiseCurve = 'exponential',
    outroFinalCurve = 'exponential',
    // Stereo
    stereoHost = DEFAULT_STEREO_HOST,
    stereoGuest = DEFAULT_STEREO_GUEST,
    // Overlaps
    overlapReactionMs = DEFAULT_OVERLAP_SHORT_REACTION,
    overlapInterruptMs = DEFAULT_OVERLAP_INTERRUPTING,
    overlapQuestionMs = DEFAULT_OVERLAP_AFTER_QUESTION,
    overlapSpeakerChangeMs = DEFAULT_OVERLAP_SPEAKER_CHANGE,
    overlapOverlappingMs = 500,
    // Custom audio URLs
    introUrl,
    outroUrl,
  } = options

  const stereoPositions = { HOST: stereoHost, GUEST: stereoGuest }
  const overlapOpts: OverlapSettings = {
    reactionMs: overlapReactionMs,
    interruptMs: overlapInterruptMs,
    questionMs: overlapQuestionMs,
    speakerChangeMs: overlapSpeakerChangeMs,
    overlappingMs: overlapOverlappingMs,
  }

  if (segments.length === 0) {
    return Buffer.alloc(0)
  }

  if (segments.length === 1 && !includeIntro && !includeOutro) {
    return segments[0].buffer
  }

  // Fast path for large podcasts: avoid decoding all segments to PCM
  if (segments.length > LARGE_PODCAST_THRESHOLD) {
    return concatenateLargeScale(segments, options)
  }

  console.log(`[Crossfade] Processing ${segments.length} segments with smart algorithm...`)
  console.log(`[Crossfade] Options: includeIntro=${includeIntro}, includeOutro=${includeOutro}`)
  console.log(`[Crossfade] Intro: ${introFullSec}s full + ${introBedSec}s bed@${Math.round(introBedVolume*100)}% + ${introFadeoutSec}s fade | Outro: ${outroCrossfadeSec}s crossfade`)

  // Decode and analyze all segments
  const analyzed: AnalyzedSegment[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const rawPcm = await decodeMP3(seg.buffer)
    // Apply stereo panning: HOST slightly left, GUEST slightly right
    let pcm = applyStereoPosition(rawPcm, seg.speaker, stereoPositions)

    // For (overlapping) segments, trim leading silence so the overlap
    // region contains actual speech, not TTS-generated padding
    const leadingSilenceMs = detectLeadingSilence(pcm)
    if (seg.overlapping && leadingSilenceMs > 20) {
      pcm = trimLeadingSilence(pcm, leadingSilenceMs)
      console.log(`[Crossfade] Trimmed ${leadingSilenceMs.toFixed(0)}ms leading silence from overlapping segment`)
    }

    const textAnalysis = analyzeText(seg.text)
    const silenceAtEndMs = detectTrailingSilence(pcm)

    analyzed.push({
      pcm,
      speaker: seg.speaker,
      text: seg.text,
      ...textAnalysis,
      isOverlapping: !!seg.overlapping,
      silenceAtEndMs,
    })

    const durationMs = (pcm[0].length / SAMPLE_RATE) * 1000
    console.log(`[Crossfade] Segment ${i + 1}: ${seg.speaker}${seg.overlapping ? ' (overlapping)' : ''} | ${textAnalysis.wordCount} words | ${durationMs.toFixed(0)}ms | lead-silence: ${leadingSilenceMs.toFixed(0)}ms | trail-silence: ${silenceAtEndMs.toFixed(0)}ms`)
  }

  // Build final audio with smart overlaps
  let resultChannels: Float32Array[] = [new Float32Array(0), new Float32Array(0)]
  let totalOverlapMs = 0

  for (let i = 0; i < analyzed.length; i++) {
    let segment = analyzed[i]

    // Trim trailing silence (except last segment)
    if (i < analyzed.length - 1) {
      segment = {
        ...segment,
        pcm: trimSilence(segment.pcm, segment.silenceAtEndMs)
      }
    }

    if (i === 0) {
      // First segment: apply intro if enabled, otherwise just add it
      if (includeIntro) {
        console.log(`[Crossfade] Loading intro music...`)
        const intro = await loadIntro(introUrl)
        console.log(`[Crossfade] Intro loaded: ${intro[0].length} samples (${(intro[0].length / SAMPLE_RATE).toFixed(1)}s)`)
        console.log(`[Crossfade] First segment PCM length: ${segment.pcm[0].length} samples (${(segment.pcm[0].length / SAMPLE_RATE).toFixed(1)}s)`)

        if (options.introMusicEnvelope && options.introDialogEnvelope) {
          console.log(`[Crossfade] Using envelope-based intro mixing`)
          resultChannels = applyIntroWithEnvelope(intro, segment.pcm,
            options.introMusicEnvelope, options.introDialogEnvelope)
        } else {
          resultChannels = applyIntroWithCrossfade(intro, segment.pcm, {
            fullSec: introFullSec,
            bedSec: introBedSec,
            bedVolume: introBedVolume,
            fadeoutSec: introFadeoutSec,
            dialogFadeInSec: introDialogFadeInSec,
            fadeoutCurve: introFadeoutCurve as 'linear' | 'exponential',
            dialogCurve: introDialogCurve as 'linear' | 'exponential',
          })
        }
        console.log(`[Crossfade] After intro applied, resultChannels length: ${resultChannels[0].length} samples (${(resultChannels[0].length / SAMPLE_RATE).toFixed(1)}s)`)
      } else {
        resultChannels = [segment.pcm[0], segment.pcm[1]]
      }
    } else {
      const overlapMs = calculateOverlap(analyzed[i - 1], segment, overlapOpts)
      const overlapSamples = Math.floor((overlapMs / 1000) * SAMPLE_RATE)

      if (overlapSamples > 0 && resultChannels[0].length >= overlapSamples && segment.pcm[0].length >= overlapSamples) {
        // Apply crossfade or additive overlap
        totalOverlapMs += overlapMs

        const endOfResult: Float32Array[] = [
          resultChannels[0].slice(-overlapSamples),
          resultChannels[1].slice(-overlapSamples)
        ]

        const startOfNew: Float32Array[] = [
          segment.pcm[0].slice(0, overlapSamples),
          segment.pcm[1].slice(0, overlapSamples)
        ]

        // Use additive overlap for (overlapping) segments — both voices fully audible
        // Use standard crossfade for all other overlap types
        const crossfaded = segment.isOverlapping
          ? applyAdditiveOverlap(endOfResult, startOfNew, overlapSamples)
          : applyCrossfade(endOfResult, startOfNew, overlapSamples)

        // Build new result
        const newLength = resultChannels[0].length - overlapSamples + segment.pcm[0].length
        const newResult: Float32Array[] = [
          new Float32Array(newLength),
          new Float32Array(newLength)
        ]

        for (let ch = 0; ch < 2; ch++) {
          // Copy existing audio (minus overlap)
          newResult[ch].set(resultChannels[ch].slice(0, -overlapSamples), 0)
          // Add crossfaded portion
          newResult[ch].set(crossfaded[ch], resultChannels[ch].length - overlapSamples)
          // Add rest of new segment
          newResult[ch].set(
            segment.pcm[ch].slice(overlapSamples),
            resultChannels[ch].length - overlapSamples + overlapSamples
          )
        }

        resultChannels = newResult
      } else {
        // No overlap - simple concatenation
        const newLength = resultChannels[0].length + segment.pcm[0].length
        const newResult: Float32Array[] = [
          new Float32Array(newLength),
          new Float32Array(newLength)
        ]

        for (let ch = 0; ch < 2; ch++) {
          newResult[ch].set(resultChannels[ch], 0)
          newResult[ch].set(segment.pcm[ch], resultChannels[ch].length)
        }

        resultChannels = newResult
      }
    }
  }

  let finalDurationS = resultChannels[0].length / SAMPLE_RATE
  console.log(`[Crossfade] Dialogue audio: ${finalDurationS.toFixed(1)}s | Total overlap: ${(totalOverlapMs / 1000).toFixed(1)}s saved`)

  // Apply outro if enabled
  if (includeOutro) {
    console.log(`[Crossfade] Loading outro music...`)
    const outro = await loadOutro(outroUrl)
    console.log(`[Crossfade] Outro loaded: ${outro[0].length} samples (${(outro[0].length / SAMPLE_RATE).toFixed(1)}s)`)
    console.log(`[Crossfade] Applying outro crossfade...`)

    if (options.outroMusicEnvelope && options.outroDialogEnvelope) {
      console.log(`[Crossfade] Using envelope-based outro mixing`)
      resultChannels = applyOutroWithEnvelope(resultChannels, outro,
        options.outroMusicEnvelope, options.outroDialogEnvelope)
    } else {
      resultChannels = applyOutroWithCrossfade(resultChannels, outro, {
        crossfadeSec: outroCrossfadeSec,
        riseSec: _outroRiseSec,
        bedVolume: outroBedVolume,
        finalStartSec: _outroFinalStartSec,
        riseCurve: outroRiseCurve as 'linear' | 'exponential',
        finalCurve: outroFinalCurve as 'linear' | 'exponential',
      })
    }
    finalDurationS = resultChannels[0].length / SAMPLE_RATE
    console.log(`[Crossfade] After outro: ${finalDurationS.toFixed(1)}s`)
  }

  console.log(`[Crossfade] Final audio with intro/outro: ${finalDurationS.toFixed(1)}s`)

  // Encode to MP3 (includes validation)
  console.log(`[Crossfade] Starting MP3 encoding of ${resultChannels[0].length} samples...`)
  const mp3Buffer = encodeMP3(resultChannels[0], resultChannels[1])
  console.log(`[Crossfade] ✓ MP3 encoding successful: ${(mp3Buffer.length / 1024).toFixed(0)} KB`)

  return mp3Buffer
}

/**
 * Convert MixingSettings (from DB, percentages) to CrossfadeOptions (0-1 values)
 */
export function mixingSettingsToCrossfadeOptions(
  mixing: {
    intro_enabled?: boolean
    intro_full_sec?: number
    intro_bed_sec?: number
    intro_bed_volume?: number
    intro_fadeout_sec?: number
    intro_dialog_fadein_sec?: number
    outro_enabled?: boolean
    outro_crossfade_sec?: number
    outro_rise_sec?: number
    outro_bed_volume?: number
    outro_final_start_sec?: number
    outro_rise_curve?: string
    outro_final_curve?: string
    intro_fadeout_curve?: string
    intro_dialog_curve?: string
    stereo_host?: number
    stereo_guest?: number
    overlap_reaction_ms?: number
    overlap_interrupt_ms?: number
    overlap_question_ms?: number
    overlap_speaker_ms?: number
    overlap_overlapping_ms?: number
    intro_url?: string
    outro_url?: string
    intro_music_envelope?: AudioEnvelope
    intro_dialog_envelope?: AudioEnvelope
    outro_music_envelope?: AudioEnvelope
    outro_dialog_envelope?: AudioEnvelope
  } | null | undefined
): CrossfadeOptions {
  if (!mixing) {
    return {
      includeIntro: true,
      includeOutro: true,
    }
  }

  return {
    includeIntro: mixing.intro_enabled ?? true,
    introFullSec: mixing.intro_full_sec ?? 3,
    introBedSec: mixing.intro_bed_sec ?? 7,
    introBedVolume: (mixing.intro_bed_volume ?? 20) / 100,
    introFadeoutSec: mixing.intro_fadeout_sec ?? 3,
    introDialogFadeInSec: mixing.intro_dialog_fadein_sec ?? 1,
    includeOutro: mixing.outro_enabled ?? true,
    outroCrossfadeSec: mixing.outro_crossfade_sec ?? 10,
    outroRiseSec: mixing.outro_rise_sec ?? 3,
    outroBedVolume: (mixing.outro_bed_volume ?? 20) / 100,
    outroFinalStartSec: mixing.outro_final_start_sec ?? 7,
    introFadeoutCurve: (mixing.intro_fadeout_curve as 'linear' | 'exponential') || 'exponential',
    introDialogCurve: (mixing.intro_dialog_curve as 'linear' | 'exponential') || 'exponential',
    outroRiseCurve: (mixing.outro_rise_curve as 'linear' | 'exponential') || 'exponential',
    outroFinalCurve: (mixing.outro_final_curve as 'linear' | 'exponential') || 'exponential',
    stereoHost: (mixing.stereo_host ?? 35) / 100,
    stereoGuest: (mixing.stereo_guest ?? 65) / 100,
    overlapReactionMs: mixing.overlap_reaction_ms ?? 250,
    overlapInterruptMs: mixing.overlap_interrupt_ms ?? 180,
    overlapQuestionMs: mixing.overlap_question_ms ?? 80,
    overlapSpeakerChangeMs: mixing.overlap_speaker_ms ?? 50,
    overlapOverlappingMs: mixing.overlap_overlapping_ms ?? 500,
    introUrl: mixing.intro_url,
    outroUrl: mixing.outro_url,
    introMusicEnvelope: mixing.intro_music_envelope,
    introDialogEnvelope: mixing.intro_dialog_envelope,
    outroMusicEnvelope: mixing.outro_music_envelope,
    outroDialogEnvelope: mixing.outro_dialog_envelope,
  }
}
