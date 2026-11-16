/**
 * Browser-Seite des Stimmtests: eine Skriptzeile über
 * POST /api/admin/podcast-voice-lab vertonen und als abspielbare URL liefern.
 */

import type { LineDelivery, TTSProviderId } from '@/lib/tts/line-delivery'

export interface LineAudioRequest {
  provider: TTSProviderId
  model: string
  voice: string
  /** Zeilentext wie im Skript, mit Sprechanweisung am Anfang. */
  text: string
  withDirection?: boolean
}

export interface LineAudio {
  url: string
  durationSec: number
  ms: number
  delivery: LineDelivery
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: contentType })
}

export async function requestLineAudio(req: LineAudioRequest, signal?: AbortSignal): Promise<LineAudio> {
  const res = await fetch('/api/admin/podcast-voice-lab', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(req),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || typeof data.audioBase64 !== 'string') {
    throw new Error(typeof data.error === 'string' ? data.error : `Vertonung fehlgeschlagen (${res.status})`)
  }
  const blob = base64ToBlob(data.audioBase64, data.contentType || 'audio/mpeg')
  return {
    url: URL.createObjectURL(blob),
    durationSec: Number(data.durationSec) || 0,
    ms: Number(data.ms) || 0,
    delivery: data.delivery as LineDelivery,
  }
}
