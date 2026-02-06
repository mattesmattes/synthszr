/**
 * Smart Audio Crossfade Utility
 *
 * Intelligent algorithm that analyzes dialogue patterns to create
 * natural-sounding podcast conversations with dynamic overlaps.
 */

import { MPEGDecoder } from 'mpg123-decoder'
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
}

export interface CrossfadeOptions {
  /** Add intro music at the beginning */
  includeIntro?: boolean
  /** Crossfade duration for intro in seconds (default: 4) */
  introCrossfadeSec?: number
  /** Add outro music at the end */
  includeOutro?: boolean
  /** Crossfade duration for outro in seconds (default: 4) */
  outroCrossfadeSec?: number
}

interface AnalyzedSegment {
  pcm: Float32Array[]
  speaker: 'HOST' | 'GUEST'
  text: string
  wordCount: number
  isShortReaction: boolean
  isInterrupting: boolean
  isQuestion: boolean
  endsWithTrailOff: boolean
  silenceAtEndMs: number
}

// Audio settings
const SAMPLE_RATE = 44100
const CHANNELS = 2
const BITRATE = 128

// Overlap settings (in milliseconds)
const OVERLAP_SHORT_REACTION = 250  // "Mhm!", "Ja!", "Genau!" - heavy overlap
const OVERLAP_INTERRUPTING = 180    // [interrupting] tag
const OVERLAP_AFTER_QUESTION = 80   // Quick answer after question
const OVERLAP_SPEAKER_CHANGE = 50   // Normal speaker change
const OVERLAP_SAME_SPEAKER = 0      // Same speaker continues - no overlap
const MIN_SEGMENT_FOR_OVERLAP = 300 // Don't overlap if segment < 300ms

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
 * Decode MP3 buffer to PCM samples
 */
async function decodeMP3(mp3Buffer: Buffer): Promise<Float32Array[]> {
  const decoder = new MPEGDecoder()
  await decoder.ready

  const result = decoder.decode(new Uint8Array(mp3Buffer))
  const channels: Float32Array[] = []

  for (let i = 0; i < result.channelData.length; i++) {
    channels.push(result.channelData[i])
  }

  decoder.free()

  // Ensure stereo
  if (channels.length === 1) {
    channels.push(new Float32Array(channels[0]))
  }

  return channels
}

/**
 * Encode PCM samples to MP3
 */
function encodeMP3(leftChannel: Float32Array, rightChannel: Float32Array): Buffer {
  const mp3encoder = new Mp3Encoder(CHANNELS, SAMPLE_RATE, BITRATE)

  const left = new Int16Array(leftChannel.length)
  const right = new Int16Array(rightChannel.length)

  for (let i = 0; i < leftChannel.length; i++) {
    left[i] = Math.max(-32768, Math.min(32767, Math.round(leftChannel[i] * 32767)))
    right[i] = Math.max(-32768, Math.min(32767, Math.round(rightChannel[i] * 32767)))
  }

  const mp3Data: Uint8Array[] = []
  const blockSize = 1152

  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize)
    const rightChunk = right.subarray(i, i + blockSize)
    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk)
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf)
    }
  }

  const final = mp3encoder.flush()
  if (final.length > 0) {
    mp3Data.push(final)
  }

  const totalLength = mp3Data.reduce((acc, buf) => acc + buf.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const buf of mp3Data) {
    result.set(buf, offset)
    offset += buf.length
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
function calculateOverlap(
  current: AnalyzedSegment,
  next: AnalyzedSegment
): number {
  const currentDurationMs = (current.pcm[0].length / SAMPLE_RATE) * 1000
  const nextDurationMs = (next.pcm[0].length / SAMPLE_RATE) * 1000

  // Don't overlap very short segments
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
    return Math.min(OVERLAP_SHORT_REACTION, currentDurationMs * 0.3, nextDurationMs * 0.5)
  }

  // Priority 2: Explicit interrupting tag
  if (next.isInterrupting) {
    console.log(`[Crossfade] Interrupting tag detected`)
    return Math.min(OVERLAP_INTERRUPTING, currentDurationMs * 0.25)
  }

  // Priority 3: Quick answer after question
  if (current.isQuestion) {
    return Math.min(OVERLAP_AFTER_QUESTION, currentDurationMs * 0.1)
  }

  // Priority 4: Trail-off suggests natural interruption point
  if (current.endsWithTrailOff) {
    return Math.min(OVERLAP_INTERRUPTING, currentDurationMs * 0.2)
  }

  // Default: Normal speaker change with light overlap
  return Math.min(OVERLAP_SPEAKER_CHANGE, currentDurationMs * 0.05)
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
 * Load the podcast intro MP3 file
 */
async function loadIntro(): Promise<Float32Array[]> {
  const introUrl = `${getBaseUrl()}/audio/podcast-intro.mp3`

  try {
    console.log(`[Crossfade] Fetching intro from ${introUrl}`)
    const response = await fetch(introUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch intro: ${response.status}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    console.log(`[Crossfade] Intro fetched: ${arrayBuffer.byteLength} bytes`)
    const pcm = await decodeMP3(Buffer.from(arrayBuffer))
    // Log audio stats to verify data is valid
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
 * Intro plays fully, but during the last N seconds, the first segment starts and intro fades out
 */
function applyIntroWithCrossfade(
  intro: Float32Array[],
  firstSegment: Float32Array[],
  crossfadeSec: number
): Float32Array[] {
  const crossfadeSamples = Math.floor(crossfadeSec * SAMPLE_RATE)
  const introLength = intro[0].length
  const segmentLength = firstSegment[0].length

  // Point where crossfade starts (end of intro minus crossfade duration)
  const crossfadeStart = Math.max(0, introLength - crossfadeSamples)

  // Total length: intro up to crossfade start + crossfade region + rest of first segment
  const totalLength = crossfadeStart + crossfadeSamples + Math.max(0, segmentLength - crossfadeSamples)

  const result: Float32Array[] = [
    new Float32Array(totalLength),
    new Float32Array(totalLength)
  ]

  // Copy intro up to crossfade start
  for (let ch = 0; ch < 2; ch++) {
    result[ch].set(intro[ch].slice(0, crossfadeStart), 0)
  }

  // Apply crossfade region
  for (let i = 0; i < crossfadeSamples; i++) {
    const t = i / crossfadeSamples

    // Intro fades out (exponential for smooth fade)
    const introFade = Math.pow(1 - t, 2)
    // First segment fades in
    const segmentFade = Math.pow(t, 0.7)

    // Normalize to prevent clipping
    const total = introFade + segmentFade
    const normIntro = introFade / Math.max(total, 1)
    const normSegment = segmentFade / Math.max(total, 1)

    for (let ch = 0; ch < 2; ch++) {
      const introVal = crossfadeStart + i < introLength ? intro[ch][crossfadeStart + i] : 0
      const segVal = i < segmentLength ? firstSegment[ch][i] : 0
      result[ch][crossfadeStart + i] = (introVal * normIntro) + (segVal * normSegment)
    }
  }

  // Add remaining segment after crossfade
  if (segmentLength > crossfadeSamples) {
    for (let ch = 0; ch < 2; ch++) {
      result[ch].set(
        firstSegment[ch].slice(crossfadeSamples),
        crossfadeStart + crossfadeSamples
      )
    }
  }

  const maxVal = Math.max(...result[0].slice(0, 50000).map(Math.abs))
  console.log(`[Crossfade] Applied intro with ${crossfadeSec}s crossfade. Result: ${(totalLength / SAMPLE_RATE).toFixed(1)}s, max amplitude: ${maxVal.toFixed(4)}`)

  return result
}

/**
 * Load the podcast outro MP3 file
 */
async function loadOutro(): Promise<Float32Array[]> {
  const outroUrl = `${getBaseUrl()}/audio/podcast-outro.mp3`

  try {
    console.log(`[Crossfade] Fetching outro from ${outroUrl}`)
    const response = await fetch(outroUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch outro: ${response.status}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    console.log(`[Crossfade] Outro fetched: ${arrayBuffer.byteLength} bytes`)
    const pcm = await decodeMP3(Buffer.from(arrayBuffer))
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
function applyOutroWithCrossfade(
  podcast: Float32Array[],
  outro: Float32Array[],
  crossfadeSec: number
): Float32Array[] {
  const crossfadeSamples = Math.floor(crossfadeSec * SAMPLE_RATE)
  const podcastLength = podcast[0].length
  const outroLength = outro[0].length

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

    // Podcast fades out
    const podcastFade = Math.pow(1 - t, 1.5)
    // Outro fades in
    const outroFade = Math.pow(t, 0.8)

    // Normalize to prevent clipping
    const total = podcastFade + outroFade
    const normPodcast = podcastFade / Math.max(total, 1)
    const normOutro = outroFade / Math.max(total, 1)

    for (let ch = 0; ch < 2; ch++) {
      const podcastVal = crossfadeStart + i < podcastLength ? podcast[ch][crossfadeStart + i] : 0
      const outroVal = i < outroLength ? outro[ch][i] : 0
      result[ch][crossfadeStart + i] = (podcastVal * normPodcast) + (outroVal * normOutro)
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
  console.log(`[Crossfade] Applied outro with ${crossfadeSec}s crossfade. Result: ${(totalLength / SAMPLE_RATE).toFixed(1)}s, start amp: ${maxValStart.toFixed(4)}, end amp: ${maxValEnd.toFixed(4)}`)

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
    introCrossfadeSec = 4,
    includeOutro = false,
    outroCrossfadeSec = 4
  } = options

  if (segments.length === 0) {
    return Buffer.alloc(0)
  }

  if (segments.length === 1 && !includeIntro && !includeOutro) {
    return segments[0].buffer
  }

  console.log(`[Crossfade] Processing ${segments.length} segments with smart algorithm...`)
  if (includeIntro) {
    console.log(`[Crossfade] Including intro with ${introCrossfadeSec}s crossfade`)
  }
  if (includeOutro) {
    console.log(`[Crossfade] Including outro with ${outroCrossfadeSec}s crossfade`)
  }

  // Decode and analyze all segments
  const analyzed: AnalyzedSegment[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const pcm = await decodeMP3(seg.buffer)
    const textAnalysis = analyzeText(seg.text)
    const silenceAtEndMs = detectTrailingSilence(pcm)

    analyzed.push({
      pcm,
      speaker: seg.speaker,
      text: seg.text,
      ...textAnalysis,
      silenceAtEndMs,
    })

    const durationMs = (pcm[0].length / SAMPLE_RATE) * 1000
    console.log(`[Crossfade] Segment ${i + 1}: ${seg.speaker} | ${textAnalysis.wordCount} words | ${durationMs.toFixed(0)}ms | silence: ${silenceAtEndMs.toFixed(0)}ms`)
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
        const intro = await loadIntro()
        resultChannels = applyIntroWithCrossfade(intro, segment.pcm, introCrossfadeSec)
      } else {
        resultChannels = [segment.pcm[0], segment.pcm[1]]
      }
    } else {
      const overlapMs = calculateOverlap(analyzed[i - 1], segment)
      const overlapSamples = Math.floor((overlapMs / 1000) * SAMPLE_RATE)

      if (overlapSamples > 0 && resultChannels[0].length >= overlapSamples && segment.pcm[0].length >= overlapSamples) {
        // Apply crossfade
        totalOverlapMs += overlapMs

        const endOfResult: Float32Array[] = [
          resultChannels[0].slice(-overlapSamples),
          resultChannels[1].slice(-overlapSamples)
        ]

        const startOfNew: Float32Array[] = [
          segment.pcm[0].slice(0, overlapSamples),
          segment.pcm[1].slice(0, overlapSamples)
        ]

        const crossfaded = applyCrossfade(endOfResult, startOfNew, overlapSamples)

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
    const outro = await loadOutro()
    resultChannels = applyOutroWithCrossfade(resultChannels, outro, outroCrossfadeSec)
    finalDurationS = resultChannels[0].length / SAMPLE_RATE
  }

  console.log(`[Crossfade] Final audio with intro/outro: ${finalDurationS.toFixed(1)}s`)

  // Encode to MP3
  const mp3Buffer = encodeMP3(resultChannels[0], resultChannels[1])
  console.log(`[Crossfade] Encoded MP3: ${(mp3Buffer.length / 1024).toFixed(0)} KB`)

  return mp3Buffer
}
