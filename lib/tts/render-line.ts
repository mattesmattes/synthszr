/**
 * Eine Skriptzeile vertonen, mit OpenAI oder Gemini. Gemeinsam genutzt vom
 * Audio-Job (`app/api/podcast/jobs/process`) und vom Stimmtest im Podcast
 * Studio (`app/api/admin/podcast-voice-lab`). Die OpenAI-Logik stand bis
 * 2026-11-16 unverändert im Audio-Job.
 */

import { estimateAudioDurationSec } from '@/lib/audio/wav'
import { generateSpeechGemini } from '@/lib/tts/gemini-tts'
import { DEFAULT_GEMINI_TTS_MODEL } from '@/lib/tts/gemini-voices'
import { prepareLineForTTS, type LineDelivery, type TTSProviderId } from '@/lib/tts/line-delivery'
import { MIN_AUDIO_BYTES, SUSPECT_SHORT_AUDIO_MARKER, withRetry } from '@/lib/tts/retry'

const OPENAI_TIMEOUT_MS = 30_000

/** OpenAI /v1/audio/speech, MP3. Silent-take-Schutz wie bisher im Audio-Job. */
export async function generateSpeechOpenAI(delivery: LineDelivery, voice: string, model: string): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  const cleanText = delivery.text
  if (!cleanText.trim()) return Buffer.alloc(0)

  console.log(`[TTS-OpenAI] model=${model}, voice=${voice}, len=${cleanText.length}${delivery.mode === 'instructions' ? `, emotion="${delivery.direction}"` : ', tags=stripped'}`)

  return withRetry(async () => {
    const body: Record<string, unknown> = {
      model,
      voice,
      input: cleanText,
      response_format: 'mp3',
    }
    if (delivery.instructions) {
      body.instructions = delivery.instructions
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS)
    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenAI TTS API error: ${response.status} - ${errorText}`)
      }

      const buf = Buffer.from(await response.arrayBuffer())
      // OpenAI liefert gelegentlich ein winziges MP3 ohne Fehler; als
      // vorübergehend behandeln und withRetry noch einmal versuchen lassen.
      if (buf.length < MIN_AUDIO_BYTES) {
        throw new Error(`${SUSPECT_SHORT_AUDIO_MARKER}: got ${buf.length}B for "${cleanText.slice(0, 60)}…"`)
      }
      return buf
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`OpenAI TTS timeout after ${OPENAI_TIMEOUT_MS}ms`)
      }
      throw err
    } finally {
      clearTimeout(timeoutId)
    }
  }, `OpenAI TTS (${voice})`)
}

export interface RenderLineInput {
  provider: TTSProviderId
  model?: string | null
  voice: string
  /** Zeilentext aus dem Skript, ohne „HOST:“/„GUEST:“. */
  text: string
  /** Stimmtest: Anweisung weglassen. */
  withDirection?: boolean
}

export interface RenderedLine {
  buffer: Buffer
  format: 'mp3' | 'wav'
  contentType: 'audio/mpeg' | 'audio/wav'
  durationSec: number
  delivery: LineDelivery
}

export function defaultModelFor(provider: TTSProviderId): string {
  return provider === 'gemini' ? DEFAULT_GEMINI_TTS_MODEL : 'gpt-4o-mini-tts'
}

/** Text vorbereiten (siehe line-delivery.ts) und beim Anbieter vertonen. */
export async function renderLine(input: RenderLineInput, delivery?: LineDelivery): Promise<RenderedLine> {
  const model = input.model || defaultModelFor(input.provider)
  const prepared = delivery ?? prepareLineForTTS({ provider: input.provider, model, text: input.text, withDirection: input.withDirection })

  if (input.provider === 'gemini') {
    const buffer = await generateSpeechGemini({ text: prepared.text, style: prepared.style, voice: input.voice, model })
    return { buffer, format: 'wav', contentType: 'audio/wav', durationSec: estimateAudioDurationSec(buffer), delivery: prepared }
  }

  const buffer = await generateSpeechOpenAI(prepared, input.voice, model)
  return { buffer, format: 'mp3', contentType: 'audio/mpeg', durationSec: estimateAudioDurationSec(buffer), delivery: prepared }
}
