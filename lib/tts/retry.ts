/**
 * Wiederholung bei vorübergehenden TTS-Fehlern (aus dem Audio-Job
 * `app/api/podcast/jobs/process` hierher gezogen, damit Stimmtest und Job
 * dieselbe Logik nutzen).
 */

const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY_MS = 1000

/**
 * Kleinste brauchbare Segmentgröße in Bytes. OpenAI liefert gelegentlich
 * ~200-Byte-Antworten mit HTTP 200; eine echte Sekunde MP3 hat ≥ 16 KB,
 * eine Sekunde Gemini-WAV 48 KB.
 */
export const MIN_AUDIO_BYTES = 2048
export const SUSPECT_SHORT_AUDIO_MARKER = 'suspect-short-audio-buffer'

const RETRYABLE_MARKERS = [
  '503',
  '502',
  '500',
  '429',
  'connection',
  'ECONNREFUSED',
  'timeout',
  'terminated',
  'ECONNRESET',
  'fetch failed',
  SUSPECT_SHORT_AUDIO_MARKER,
]

export function isRetryableTTSError(message: string): boolean {
  return RETRYABLE_MARKERS.some((marker) => message.includes(marker))
}

/** Exponentielles Backoff (1 s, 2 s, 4 s) für 5xx, 429, Netz- und Leerantworten. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  context: string,
  maxRetries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (!isRetryableTTSError(lastError.message) || attempt === maxRetries) {
        throw lastError
      }

      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt)
      console.log(`[Podcast Jobs] ${context} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${lastError.message}`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}
