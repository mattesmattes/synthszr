/**
 * Gemini-TTS über die Interactions-API (lib/tts/gemini-tts.ts) und die
 * WAV-Helfer für Mischer und Audio-Job (lib/audio/wav.ts). Kein echter
 * Netzaufruf: fetch wird ersetzt.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildGeminiTtsRequest,
  extractGeminiAudio,
  generateSpeechGemini,
  GEMINI_INTERACTIONS_URL,
  rateLimitWaitMs,
  requestGeminiSpeech,
} from '@/lib/tts/gemini-tts'
import { ensureWav, estimateAudioDurationSec, isWavBuffer, pcm16ToWav, readWavInfo, wavDurationSeconds } from '@/lib/audio/wav'

/** Eine Sekunde Stille, 24 kHz mono 16 Bit. */
const oneSecondPcm = Buffer.alloc(48000)

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function interaction(data: string) {
  return {
    id: 'int_1',
    status: 'completed',
    steps: [
      { type: 'user_input', content: [{ type: 'text', text: 'Hi' }] },
      { type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data }] },
    ],
  }
}

describe('buildGeminiTtsRequest', () => {
  it('baut den dokumentierten Body: Text wörtlich, style als speech_metadata, Stimme im speech_config-Array', () => {
    expect(buildGeminiTtsRequest({ text: 'Have a wonderful day!', style: 'cheerful and friendly', voice: 'Kore', model: 'gemini-3.8-flash-tts' })).toEqual({
      model: 'gemini-3.8-flash-tts',
      input: [{ type: 'user_input', content: [{ type: 'text', text: 'Have a wonderful day!', annotations: [{ type: 'speech_metadata', style: 'cheerful and friendly' }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: 'Kore' }] },
    })
  })

  it('lässt annotations ohne style weg', () => {
    const body = buildGeminiTtsRequest({ text: 'Hi', voice: 'Puck', model: 'gemini-3.8-flash-lite-tts' })
    expect(body.input[0].content[0]).toEqual({ type: 'text', text: 'Hi' })
  })
})

describe('extractGeminiAudio', () => {
  it('nimmt das letzte Audio aus dem model_output-Schritt', () => {
    const json = {
      steps: [
        { type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: 'AAAA' }] },
        { type: 'model_output', content: [{ type: 'text', text: 'note' }, { type: 'audio', mime_type: 'audio/wav', data: 'BBBB' }] },
      ],
    }
    expect(extractGeminiAudio(json)).toEqual({ data: 'BBBB', mimeType: 'audio/wav' })
  })

  it('versteht auch output_audio und outputs[]', () => {
    expect(extractGeminiAudio({ output_audio: { data: 'CCCC', mime_type: 'audio/l16;rate=24000' } })).toEqual({ data: 'CCCC', mimeType: 'audio/l16;rate=24000' })
    expect(extractGeminiAudio({ outputs: [{ type: 'text', text: 'x' }, { type: 'audio', data: 'DDDD' }] })).toEqual({ data: 'DDDD', mimeType: null })
    expect(extractGeminiAudio({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'no audio' }] }] })).toBeNull()
  })
})

describe('rateLimitWaitMs', () => {
  it('liest Retry-After oder retryDelay und kappt bei 20 s', () => {
    expect(rateLimitWaitMs('3', '')).toBe(3000)
    expect(rateLimitWaitMs(null, '{"error":{"details":[{"retryDelay":"7s"}]}}')).toBe(7000)
    expect(rateLimitWaitMs('120', '')).toBe(20000)
    expect(rateLimitWaitMs(null, 'nothing')).toBe(0)
  })
})

describe('requestGeminiSpeech', () => {
  it('schickt den Schlüssel im Header und liefert eine WAV-Datei', async () => {
    const wav = pcm16ToWav(oneSecondPcm)
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(interaction(wav.toString('base64'))))
    const out = await requestGeminiSpeech({ text: 'Hi', voice: 'Kore', model: 'gemini-3.8-flash-tts', apiKey: 'test-key', fetchImpl })
    expect(isWavBuffer(out)).toBe(true)
    expect(wavDurationSeconds(out)).toBeCloseTo(1, 5)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(GEMINI_INTERACTIONS_URL)
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key')
    expect(JSON.parse(String(init?.body)).generation_config.speech_config).toEqual([{ voice: 'Kore' }])
  })

  it('verpackt kopfloses PCM in WAV', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ output_audio: { data: oneSecondPcm.toString('base64'), mime_type: 'audio/l16;rate=24000' } }))
    const out = await requestGeminiSpeech({ text: 'Hi', voice: 'Kore', model: 'gemini-3.8-flash-tts', apiKey: 'k', fetchImpl })
    expect(readWavInfo(out)).toMatchObject({ sampleRate: 24000, channels: 1, bitsPerSample: 16, dataBytes: 48000 })
  })

  it('wirft mit Status im Text (für withRetry) und markiert leere Antworten', async () => {
    const err500 = vi.fn(async () => jsonResponse({ error: { code: 500, status: 'INTERNAL', message: 'boom' } }, 500))
    await expect(requestGeminiSpeech({ text: 'Hi', voice: 'Kore', model: 'm', apiKey: 'k', fetchImpl: err500 })).rejects.toThrow(/Gemini TTS API error: 500 - INTERNAL: boom/)
    const empty = vi.fn(async () => jsonResponse({ status: 'failed', steps: [] }))
    await expect(requestGeminiSpeech({ text: 'Hi', voice: 'Kore', model: 'm', apiKey: 'k', fetchImpl: empty })).rejects.toThrow(/suspect-short-audio-buffer/)
    const tiny = vi.fn(async () => jsonResponse(interaction(pcm16ToWav(Buffer.alloc(200)).toString('base64'))))
    await expect(requestGeminiSpeech({ text: 'Hi', voice: 'Kore', model: 'm', apiKey: 'k', fetchImpl: tiny })).rejects.toThrow(/suspect-short-audio-buffer/)
  })

  it('verlangt einen Schlüssel', async () => {
    const before = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    await expect(requestGeminiSpeech({ text: 'Hi', voice: 'Kore', model: 'm', fetchImpl: vi.fn() })).rejects.toThrow(/GOOGLE_GENERATIVE_AI_API_KEY/)
    if (before !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = before
  })
})

describe('generateSpeechGemini', () => {
  it('wiederholt nach einem 503 und liefert dann das Audio', async () => {
    const wav = pcm16ToWav(oneSecondPcm)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 503, status: 'UNAVAILABLE', message: 'overloaded' } }, 503))
      .mockResolvedValueOnce(jsonResponse(interaction(wav.toString('base64'))))
    const out = await generateSpeechGemini({ text: 'Hi', voice: 'Kore', model: 'gemini-3.8-flash-tts', apiKey: 'k', fetchImpl })
    expect(isWavBuffer(out)).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('WAV-Helfer', () => {
  it('kappt zu große data-Längen (Streaming-Köpfe), damit der Mischer nicht über das Ende liest', () => {
    const wav = pcm16ToWav(oneSecondPcm)
    wav.writeUInt32LE(0xffffffff, 40)
    expect(readWavInfo(wav)?.dataBytes).toBe(48000)
    const fixed = ensureWav(wav)
    expect(fixed.readUInt32LE(40)).toBe(48000)
    expect(fixed.readUInt32LE(4)).toBe(fixed.length - 8)
  })

  it('misst WAV aus dem Kopf und MP3 mit der 128-kbps-Annahme des Mischers', () => {
    expect(estimateAudioDurationSec(pcm16ToWav(Buffer.alloc(96000)))).toBeCloseTo(2, 5)
    expect(estimateAudioDurationSec(Buffer.alloc(16384))).toBeCloseTo(1, 5)
  })
})
