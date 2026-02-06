/**
 * Stereo Podcast Mixer
 *
 * Mixes podcast segments into a stereo audio file with natural positioning:
 * - HOST: 65% left, 35% right (slightly left of center)
 * - GUEST: 35% left, 65% right (slightly right of center)
 *
 * This creates a natural "two people at a table" feel instead of
 * the unnatural hard-panned 100% left/right separation.
 *
 * Supports overlapping audio when speakers interrupt each other.
 */

// Stereo panning configuration (0.0 = full left, 1.0 = full right)
// 0.35 = 65% left, 35% right | 0.65 = 35% left, 65% right
const STEREO_POSITION = {
  HOST: 0.35,   // Slightly left of center
  GUEST: 0.65,  // Slightly right of center
} as const

export interface SegmentMetadata {
  index: number
  speaker: 'HOST' | 'GUEST'
  text: string
  startTime: number
  durationEstimate: number
}

export interface MixerOptions {
  segmentUrls: string[]
  segmentMetadata: SegmentMetadata[]
  sampleRate?: number
}

export interface MixResult {
  audioBuffer: AudioBuffer
  duration: number
  blob?: Blob
}

/**
 * Load and decode an audio segment from URL
 */
async function loadSegment(
  audioContext: AudioContext,
  url: string,
  index: number
): Promise<AudioBuffer> {
  console.log(`[StereoMixer] Fetching segment ${index}: ${url.substring(0, 80)}...`)

  const response = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch segment ${index}: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  console.log(`[StereoMixer] Segment ${index} fetched: ${arrayBuffer.byteLength} bytes`)

  try {
    return await audioContext.decodeAudioData(arrayBuffer)
  } catch (decodeError) {
    console.error(`[StereoMixer] Failed to decode segment ${index}:`, decodeError)
    throw new Error(`Failed to decode audio segment ${index}`)
  }
}

/**
 * Mix podcast segments into a stereo AudioBuffer
 * HOST = Left channel, GUEST = Right channel
 */
export async function mixToStereo(options: MixerOptions): Promise<MixResult> {
  const { segmentUrls, segmentMetadata, sampleRate = 48000 } = options

  if (segmentUrls.length !== segmentMetadata.length) {
    throw new Error('Segment URLs and metadata must have the same length')
  }

  const audioContext = new AudioContext({ sampleRate })

  // Load all segments
  console.log(`[StereoMixer] Loading ${segmentUrls.length} segments...`)
  const decodedSegments: AudioBuffer[] = []
  for (let i = 0; i < segmentUrls.length; i++) {
    const buffer = await loadSegment(audioContext, segmentUrls[i], i)
    decodedSegments.push(buffer)
    console.log(`[StereoMixer] Segment ${i} decoded: ${buffer.duration.toFixed(2)}s, ${buffer.numberOfChannels}ch`)
  }

  // Post-process timing for natural overlaps (helps OpenAI which has no emotion tags)
  // Heuristic: short responses (< 2s) when speaker changes are likely reactions/interruptions
  const REACTION_THRESHOLD = 2.0  // seconds
  const REACTION_OVERLAP = 0.15   // 150ms overlap for reactions
  const INTERRUPTION_OVERLAP = 0.3 // 300ms overlap for very short responses

  const adjustedStartTimes: number[] = []
  let currentTime = 0

  for (let i = 0; i < decodedSegments.length; i++) {
    const segment = decodedSegments[i]
    const meta = segmentMetadata[i]
    const prevMeta = i > 0 ? segmentMetadata[i - 1] : null
    const prevDuration = i > 0 ? decodedSegments[i - 1].duration : 0

    // Check for speaker change
    const speakerChanged = prevMeta && prevMeta.speaker !== meta.speaker

    if (speakerChanged) {
      // Calculate overlap based on response length
      const responseDuration = segment.duration
      let overlap = 0

      if (responseDuration < 1.0) {
        // Very short response (< 1s) - likely an interruption
        overlap = INTERRUPTION_OVERLAP
      } else if (responseDuration < REACTION_THRESHOLD) {
        // Short response (< 2s) - likely a reaction
        overlap = REACTION_OVERLAP
      }

      // Previous segment end time minus overlap
      const prevEndTime = adjustedStartTimes[i - 1] + prevDuration
      currentTime = Math.max(0, prevEndTime - overlap)

      if (overlap > 0) {
        console.log(`[StereoMixer] Segment ${i}: applying ${(overlap * 1000).toFixed(0)}ms overlap (${responseDuration.toFixed(1)}s response)`)
      }
    } else if (i > 0) {
      // Same speaker continues - no gap
      currentTime = adjustedStartTimes[i - 1] + prevDuration
    }

    adjustedStartTimes.push(currentTime)
  }

  // Calculate total duration based on adjusted timing
  let totalDuration = 0
  for (let i = 0; i < decodedSegments.length; i++) {
    const startTime = adjustedStartTimes[i]
    const duration = decodedSegments[i].duration
    const endTime = startTime + duration
    if (endTime > totalDuration) {
      totalDuration = endTime
    }
  }

  // Add a small buffer at the end
  totalDuration += 0.5

  console.log(`[StereoMixer] Creating stereo buffer: ${totalDuration.toFixed(2)}s`)

  // Create stereo output buffer
  const totalSamples = Math.ceil(totalDuration * sampleRate)
  const outputBuffer = audioContext.createBuffer(2, totalSamples, sampleRate)
  const leftChannel = outputBuffer.getChannelData(0)  // HOST
  const rightChannel = outputBuffer.getChannelData(1) // GUEST

  // Mix each segment with natural stereo positioning
  for (let i = 0; i < decodedSegments.length; i++) {
    const segment = decodedSegments[i]
    const meta = segmentMetadata[i]
    // Use adjusted start time for natural overlaps
    const startSample = Math.floor(adjustedStartTimes[i] * sampleRate)

    // Get source channel data (use first channel if mono)
    const sourceData = segment.getChannelData(0)

    // Get stereo position (0.0 = full left, 1.0 = full right)
    const pan = STEREO_POSITION[meta.speaker]

    // Calculate gain for each channel using constant-power panning
    // This maintains perceived loudness across the stereo field
    const leftGain = Math.cos(pan * Math.PI / 2)   // 0.35 -> ~0.94 (65%)
    const rightGain = Math.sin(pan * Math.PI / 2)  // 0.35 -> ~0.54 (35%)

    // Mix samples to both channels with appropriate gains
    for (let j = 0; j < sourceData.length && (startSample + j) < leftChannel.length; j++) {
      const sample = sourceData[j]
      // Add to existing data (allows overlapping)
      leftChannel[startSample + j] += sample * leftGain
      rightChannel[startSample + j] += sample * rightGain
    }

    console.log(`[StereoMixer] Mixed segment ${i} (${meta.speaker}) at ${adjustedStartTimes[i].toFixed(2)}s, pan=${pan} (L:${(leftGain*100).toFixed(0)}% R:${(rightGain*100).toFixed(0)}%)`)
  }

  // Normalize to prevent clipping
  normalizeBuffer(outputBuffer)

  await audioContext.close()

  return {
    audioBuffer: outputBuffer,
    duration: totalDuration,
  }
}

/**
 * Normalize audio buffer to prevent clipping
 */
function normalizeBuffer(buffer: AudioBuffer): void {
  let maxSample = 0

  // Find max sample across all channels
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i])
      if (abs > maxSample) maxSample = abs
    }
  }

  // Only normalize if clipping would occur
  if (maxSample > 1.0) {
    const gain = 0.95 / maxSample
    console.log(`[StereoMixer] Normalizing with gain ${gain.toFixed(3)}`)

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel)
      for (let i = 0; i < data.length; i++) {
        data[i] *= gain
      }
    }
  }
}

/**
 * Convert AudioBuffer to WAV Blob
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample

  // Interleave channels
  const length = buffer.length * numChannels
  const interleaved = new Int16Array(length)

  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = buffer.getChannelData(channel)[i]
      // Clamp and convert to 16-bit
      const clamped = Math.max(-1, Math.min(1, sample))
      interleaved[i * numChannels + channel] = clamped < 0
        ? clamped * 0x8000
        : clamped * 0x7FFF
    }
  }

  // Create WAV header
  const dataSize = interleaved.length * bytesPerSample
  const headerSize = 44
  const fileSize = headerSize + dataSize

  const arrayBuffer = new ArrayBuffer(fileSize)
  const view = new DataView(arrayBuffer)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, fileSize - 8, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // chunk size
  view.setUint16(20, 1, true) // audio format (PCM)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // Write audio data
  const dataView = new Int16Array(arrayBuffer, headerSize)
  dataView.set(interleaved)

  return new Blob([arrayBuffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

/**
 * Play a stereo AudioBuffer
 */
export function playAudioBuffer(buffer: AudioBuffer): AudioBufferSourceNode {
  const audioContext = new AudioContext()
  const source = audioContext.createBufferSource()
  source.buffer = buffer
  source.connect(audioContext.destination)
  source.start(0)
  return source
}

/**
 * Download audio as WAV file
 */
export function downloadWav(blob: Blob, filename: string = 'podcast-stereo.wav'): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
