/**
 * Gemini-TTS über die Interactions-API (Google AI Studio, Stand 2026-11-16):
 * POST https://generativelanguage.googleapis.com/v1beta/interactions,
 * Schlüssel im Header `x-goog-api-key` (GOOGLE_GENERATIVE_AI_API_KEY, wie
 * Übersetzung und Embeddings). Der Text wird wörtlich vorgelesen; Ton,
 * Tempo und Gefühl eines Turns stehen in `speech_metadata.style`.
 *
 * Antwort: Base64-Audio in `steps[type=model_output].content[type=audio].data`
 * (die SDKs nennen es `output_audio.data`), im Unary-Aufruf als WAV
 * (24 kHz, mono, 16 Bit). Sprache erkennt das Modell selbst.
 */

import { ensureWav, wavDurationSeconds } from '@/lib/audio/wav'
import { SUSPECT_SHORT_AUDIO_MARKER, withRetry } from '@/lib/tts/retry'

export const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'

/** Ein Turn von 200 Wörtern braucht deutlich länger als eine OpenAI-Zeile. */
const GEMINI_TIMEOUT_MS = 90_000
/** Kürzeste plausible Aufnahme: eine Reaktion wie „Mm.“ dauert ≥ 0,3 s. */
const MIN_GEMINI_AUDIO_SEC = 0.15
/** Obergrenze für das Warten auf ein 429 (Retry-After / retryDelay). */
const MAX_RATE_LIMIT_WAIT_MS = 20_000

export interface GeminiSpeechRequest {
  text: string
  style?: string
  voice: string
  model: string
}

export function buildGeminiTtsRequest({ text, style, voice, model }: GeminiSpeechRequest) {
  const item: Record<string, unknown> = { type: 'text', text }
  if (style?.trim()) {
    item.annotations = [{ type: 'speech_metadata', style: style.trim() }]
  }
  return {
    model,
    input: [{ type: 'user_input', content: [item] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  }
}

type Json = Record<string, unknown>

function asRecord(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
}

function audioOf(item: unknown): { data: string; mimeType: string | null } | null {
  const rec = asRecord(item)
  if (!rec || typeof rec.data !== 'string' || !rec.data) return null
  if (rec.type !== undefined && rec.type !== 'audio') return null
  const mime = rec.mime_type ?? rec.mimeType
  return { data: rec.data, mimeType: typeof mime === 'string' ? mime : null }
}

/**
 * Base64-Audio aus der Antwort: `output_audio` (SDK-Form), sonst das letzte
 * Audio im letzten `model_output`-Schritt, sonst `outputs[]` (ältere Form).
 */
export function extractGeminiAudio(json: unknown): { data: string; mimeType: string | null } | null {
  const root = asRecord(json)
  if (!root) return null
  const direct = audioOf(root.output_audio)
  if (direct) return direct

  let found: { data: string; mimeType: string | null } | null = null
  const steps = Array.isArray(root.steps) ? root.steps : []
  for (const step of steps) {
    const rec = asRecord(step)
    if (!rec || rec.type !== 'model_output' || !Array.isArray(rec.content)) continue
    for (const item of rec.content) {
      const audio = asRecord(item)?.type === 'audio' ? audioOf(item) : null
      if (audio) found = audio
    }
  }
  if (found) return found

  const outputs = Array.isArray(root.outputs) ? root.outputs : []
  for (const item of outputs) {
    const audio = asRecord(item)?.type === 'audio' ? audioOf(item) : null
    if (audio) found = audio
  }
  return found
}

/** Wartezeit aus `Retry-After` (Sekunden) oder `retryDelay: "17s"` im Fehlerkörper. */
export function rateLimitWaitMs(retryAfter: string | null, bodyText: string): number {
  const header = Number(retryAfter)
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, MAX_RATE_LIMIT_WAIT_MS)
  const fromBody = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(bodyText)
  if (fromBody) return Math.min(Number(fromBody[1]) * 1000, MAX_RATE_LIMIT_WAIT_MS)
  return 0
}

function errorMessageOf(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string; status?: string } }
    const msg = [parsed.error?.status, parsed.error?.message].filter(Boolean).join(': ')
    if (msg) return msg.slice(0, 400)
  } catch {
    // kein JSON
  }
  return bodyText.slice(0, 400)
}

export interface GeminiSpeechOptions extends GeminiSpeechRequest {
  /** Nur für Tests. */
  fetchImpl?: typeof fetch
  apiKey?: string
  timeoutMs?: number
}

/** Ein Aufruf ohne Wiederholung; wirft bei Fehlern mit dem HTTP-Status im Text. */
export async function requestGeminiSpeech(opts: GeminiSpeechOptions): Promise<Buffer> {
  const apiKey = opts.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not set')
  const doFetch = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? GEMINI_TIMEOUT_MS

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await doFetch(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(buildGeminiTtsRequest(opts)),
      signal: controller.signal,
    })

    if (!response.ok) {
      const bodyText = await response.text()
      if (response.status === 429) {
        const wait = rateLimitWaitMs(response.headers.get('retry-after'), bodyText)
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      }
      throw new Error(`Gemini TTS API error: ${response.status} - ${errorMessageOf(bodyText)}`)
    }

    const json = (await response.json()) as unknown
    const audio = extractGeminiAudio(json)
    if (!audio) {
      const status = asRecord(json)?.status
      throw new Error(`${SUSPECT_SHORT_AUDIO_MARKER}: Gemini lieferte kein Audio (status=${typeof status === 'string' ? status : 'unbekannt'})`)
    }

    const wav = ensureWav(Buffer.from(audio.data, 'base64'), audio.mimeType)
    const seconds = wavDurationSeconds(wav)
    if (seconds < MIN_GEMINI_AUDIO_SEC) {
      throw new Error(`${SUSPECT_SHORT_AUDIO_MARKER}: Gemini lieferte ${seconds.toFixed(2)} s für "${opts.text.slice(0, 60)}…"`)
    }
    return wav
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Gemini TTS timeout after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

/** Mit Wiederholung bei 429, 5xx, Netzfehlern und leeren Antworten. */
export async function generateSpeechGemini(opts: GeminiSpeechOptions): Promise<Buffer> {
  console.log(`[TTS-Gemini] model=${opts.model}, voice=${opts.voice}, len=${opts.text.length}${opts.style ? `, style="${opts.style}"` : ', style=none'}`)
  return withRetry(() => requestGeminiSpeech(opts), `Gemini TTS (${opts.voice})`)
}
