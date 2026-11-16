/**
 * Gemini-TTS in der Podcast-Audio-Pipeline (Betreiber 2026-11-16: „Ergänze die
 * heutigen Pipelines um Gemini-TTS mit Sprachauswahl und Sprecherauswahl zum
 * Testen“).
 *
 * - renderLine vertont eine Zeile mit OpenAI (MP3) oder Gemini (WAV), so wie
 *   Audio-Job und Stimmtest es tun.
 * - Der Audio-Job verzweigt nach `provider`, lädt WAV-Segmente als .wav hoch
 *   und misst ihre Dauer aus dem Kopf; ein Testlauf ohne Post ändert
 *   Persönlichkeit und Episoden-Gedächtnis nicht mehr (Befund: 20
 *   Gedächtniszeilen ohne Post aus alten Tests).
 * - Der Mischer dekodiert Segmente über decodeAudio (WAV oder MP3).
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderLine } from '@/lib/tts/render-line'
import { pcm16ToWav } from '@/lib/audio/wav'

const PROCESS_ROUTE = readFileSync('app/api/podcast/jobs/process/route.ts', 'utf-8')
const JOBS_ROUTE = readFileSync('app/api/podcast/jobs/route.ts', 'utf-8')
const MIXER = readFileSync('lib/audio/crossfade.ts', 'utf-8')
const ADMIN_PAGE = readFileSync('app/admin/audio/page.tsx', 'utf-8')
const SETTINGS_API = readFileSync('app/api/admin/tts-settings/route.ts', 'utf-8')

const env = { ...process.env }

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-openai'
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google'
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env.OPENAI_API_KEY = env.OPENAI_API_KEY
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = env.GOOGLE_GENERATIVE_AI_API_KEY
  if (env.OPENAI_API_KEY === undefined) delete process.env.OPENAI_API_KEY
  if (env.GOOGLE_GENERATIVE_AI_API_KEY === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
})

describe('renderLine', () => {
  it('OpenAI: MP3, Anweisung nur für gpt-4o-mini-tts als instructions', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array(32768), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const hd = await renderLine({ provider: 'openai', model: 'tts-1-hd', voice: 'shimmer', text: '[dry, quick] Synthszr says no.' })
    expect(hd).toMatchObject({ format: 'mp3', contentType: 'audio/mpeg', durationSec: 2 })
    const hdBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(hdBody).toEqual({ model: 'tts-1-hd', voice: 'shimmer', input: 'Synthesizer says no.', response_format: 'mp3' })

    await renderLine({ provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'shimmer', text: '[dry, quick] Hi.' })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).instructions).toBe('dry, quick')
  })

  it('Gemini: WAV, Anweisung als style, Stimme aus dem Kit', async () => {
    const wav = pcm16ToWav(Buffer.alloc(72000)) // 1,5 s
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: wav.toString('base64') }] }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const out = await renderLine({ provider: 'gemini', model: 'gemini-3.8-flash-tts', voice: 'Charon', text: '[booming, emphatic] It ends in tears. [laughs]' })
    expect(out).toMatchObject({ format: 'wav', contentType: 'audio/wav' })
    expect(out.durationSec).toBeCloseTo(1.5, 5)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.generation_config.speech_config).toEqual([{ voice: 'Charon' }])
    expect(body.input[0].content[0]).toEqual({
      type: 'text',
      text: 'It ends in tears. <laugh>',
      annotations: [{ type: 'speech_metadata', style: 'booming, emphatic' }],
    })
  })
})

describe('Audio-Job und Mischer', () => {
  it('verzweigt nach Anbieter und nutzt die gemeinsame Umsetzung', () => {
    expect(PROCESS_ROUTE).toMatch(/job\.provider === 'gemini' \? 'gemini' : 'openai'/)
    expect(PROCESS_ROUTE).toMatch(/prepareLineForTTS\(/)
    expect(PROCESS_ROUTE).toMatch(/renderLine\(/)
    expect(PROCESS_ROUTE).toMatch(/seg\$\{globalIndex\.toString\(\)\.padStart\(3, '0'\)\}\.\$\{rendered\.format\}/)
    expect(PROCESS_ROUTE).toMatch(/contentType: rendered\.contentType/)
    expect(PROCESS_ROUTE).toMatch(/estimateAudioDurationSec\(seg\.buffer\)/)
  })

  it('lässt Persönlichkeit und Gedächtnis bei Testläufen ohne Post unverändert', () => {
    const guard = PROCESS_ROUTE.indexOf('if (!job.post_id) {')
    expect(guard).toBeGreaterThan(-1)
    for (const call of ['advanceState(', 'extractEpisodeMemory(', 'consumeMemoryAwakeningSlot(']) {
      expect(PROCESS_ROUTE.indexOf(call), call).toBeGreaterThan(guard)
    }
  })

  it('dekodiert Segmente als WAV oder MP3', () => {
    expect(MIXER).not.toMatch(/decodeMP3\((segments\[0\]|segments\[i\]|seg)\.buffer\)/)
    expect(MIXER.match(/decodeAudio\((segments\[0\]|segments\[i\]|seg)\.buffer\)/g)).toHaveLength(3)
    expect(MIXER).toMatch(/estimateAudioDurationSec\(segments\[i\]\.buffer\)/)
  })

  it('prüft Gemini-Modell und -Stimmen beim Anlegen des Jobs', () => {
    expect(JOBS_ROUTE).toMatch(/provider === 'gemini'/)
    expect(JOBS_ROUTE).toMatch(/isGeminiTTSModel\(body\.model\)/)
    expect(JOBS_ROUTE).toMatch(/isGeminiVoice\(body\.hostVoiceId\) \|\| !isGeminiVoice\(body\.guestVoiceId\)/)
  })
})

describe('Podcast Studio', () => {
  it('schickt Anbieter, Modell und Stimmen der Skriptsprache; Testlauf ohne Post', () => {
    expect(ADMIN_PAGE).toMatch(/provider: useGemini \? \('gemini' as const\) : \('openai' as const\)/)
    expect(ADMIN_PAGE).toMatch(/geminiCast\.voices\[ttsLangOf\(selectedLocale\)\]/)
    expect(ADMIN_PAGE).toMatch(/postId: linkToPost \? selectedPostId : undefined/)
    expect(ADMIN_PAGE).toMatch(/value="voicelab"/)
  })

  it('speichert Anbieter und Gemini-Besetzung nur mit gültigen Werten', () => {
    expect(SETTINGS_API).toMatch(/podcast_tts_provider !== 'openai' && body\.podcast_tts_provider !== 'gemini'/)
    expect(SETTINGS_API).toMatch(/isGeminiTTSModel\(body\.gemini_tts_model\)/)
    expect(SETTINGS_API).toMatch(/isGeminiVoice\(value\)/)
  })
})
