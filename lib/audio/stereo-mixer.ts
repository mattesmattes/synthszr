/**
 * Stereo Podcast Mixer
 *
 * Mixes podcast segments into a stereo audio file:
 * - HOST audio on the LEFT channel
 * - GUEST audio on the RIGHT channel
 *
 * Supports overlapping audio when speakers interrupt each other.
 */

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
  url: string
): Promise<AudioBuffer> {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()
  return audioContext.decodeAudioData(arrayBuffer)
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
    const buffer = await loadSegment(audioContext, segmentUrls[i])
    decodedSegments.push(buffer)
    console.log(`[StereoMixer] Segment ${i}: ${buffer.duration.toFixed(2)}s, ${buffer.numberOfChannels}ch`)
  }

  // Calculate total duration based on actual decoded audio
  let totalDuration = 0
  for (let i = 0; i < decodedSegments.length; i++) {
    const startTime = segmentMetadata[i].startTime
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

  // Mix each segment into the appropriate channel
  for (let i = 0; i < decodedSegments.length; i++) {
    const segment = decodedSegments[i]
    const meta = segmentMetadata[i]
    const startSample = Math.floor(meta.startTime * sampleRate)

    // Get source channel data (use first channel if mono)
    const sourceData = segment.getChannelData(0)

    // Determine target channel based on speaker
    const targetChannel = meta.speaker === 'HOST' ? leftChannel : rightChannel

    // Copy samples to target channel
    for (let j = 0; j < sourceData.length && (startSample + j) < targetChannel.length; j++) {
      // Add to existing data (allows overlapping)
      targetChannel[startSample + j] += sourceData[j]
    }

    console.log(`[StereoMixer] Mixed segment ${i} (${meta.speaker}) at ${meta.startTime.toFixed(2)}s`)
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
