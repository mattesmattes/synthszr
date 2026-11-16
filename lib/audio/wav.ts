/**
 * WAV-Helfer für Sprachsegmente (Gemini-TTS liefert WAV, OpenAI MP3).
 *
 * Reine Byte-Rechnung ohne Abhängigkeiten, damit Mischer, Audio-Job und
 * Stimmtest dieselbe Dauer messen. Gemini antwortet im Unary-Aufruf mit
 * einer WAV-Datei (RIFF, 44-Byte-Kopf, 24 kHz, mono, 16 Bit), beim
 * Streaming mit kopflosem PCM; `ensureWav` macht aus beidem eine WAV-Datei
 * mit stimmigen Längenfeldern.
 */

/** Byte-Rate, mit der der Mischer MP3-Segmente schon immer schätzt (128 kbps). */
export const MP3_BYTES_PER_SECOND = (128 * 1024) / 8

export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  dataOffset: number
  dataBytes: number
}

export function isWavBuffer(buf: Uint8Array): boolean {
  return (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45 // WAVE
  )
}

/**
 * Liest fmt- und data-Chunk. `dataBytes` ist auf das tatsächlich Vorhandene
 * gekappt: Streaming-Köpfe tragen oft 0 oder 0xFFFFFFFF als Länge.
 */
export function readWavInfo(buf: Buffer): WavInfo | null {
  if (!isWavBuffer(buf)) return null
  let offset = 12
  let fmt: Omit<WavInfo, 'dataOffset' | 'dataBytes'> | null = null
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'fmt ' && offset + 24 <= buf.length) {
      fmt = {
        channels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bitsPerSample: buf.readUInt16LE(offset + 22),
      }
    } else if (id === 'data') {
      if (!fmt) return null
      const dataOffset = offset + 8
      const available = buf.length - dataOffset
      const dataBytes = size === 0 || size > available ? available : size
      return { ...fmt, dataOffset, dataBytes }
    }
    offset += 8 + size + (size % 2)
  }
  return null
}

export function wavDurationSeconds(buf: Buffer): number {
  const info = readWavInfo(buf)
  if (!info) return 0
  const bytesPerSecond = info.sampleRate * info.channels * (info.bitsPerSample / 8)
  return bytesPerSecond > 0 ? info.dataBytes / bytesPerSecond : 0
}

/** Dauer eines Segments: WAV aus dem Kopf, MP3 mit der 128-kbps-Annahme des Mischers. */
export function estimateAudioDurationSec(buf: Buffer): number {
  return isWavBuffer(buf) ? wavDurationSeconds(buf) : buf.length / MP3_BYTES_PER_SECOND
}

/** Kopfloses 16-Bit-PCM (little endian) in eine WAV-Datei verpacken. */
export function pcm16ToWav(pcm: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const header = Buffer.alloc(44)
  const byteRate = sampleRate * channels * 2
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt-Chunk-Länge
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(channels * 2, 32) // Block-Align
  header.writeUInt16LE(16, 34) // Bit je Sample
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/**
 * Liefert eine WAV-Datei mit stimmigen Längenfeldern. Kopfloses PCM wird
 * verpackt (Rate aus `mimeType` wie `audio/l16;rate=24000`, sonst 24 kHz).
 * Der Mischer liest die data-Länge wörtlich; eine zu große Angabe ließe ihn
 * über das Pufferende lesen.
 */
export function ensureWav(buf: Buffer, mimeType?: string | null): Buffer {
  if (!isWavBuffer(buf)) {
    const rate = Number(/rate=(\d+)/i.exec(mimeType ?? '')?.[1]) || 24000
    // Ein halbes Sample am Ende würde den Mischer ein Byte zu weit lesen lassen.
    const even = buf.length % 2 === 0 ? buf : buf.subarray(0, buf.length - 1)
    return pcm16ToWav(even, rate, 1)
  }
  const info = readWavInfo(buf)
  if (!info) return buf
  const fixed = Buffer.from(buf.subarray(0, info.dataOffset + info.dataBytes))
  fixed.writeUInt32LE(fixed.length - 8, 4)
  fixed.writeUInt32LE(info.dataBytes, info.dataOffset - 4)
  return fixed
}
