// @vitest-environment jsdom
/**
 * Tab „Stimmtest“ im Podcast Studio (Betreiber 2026-11-16): echte Skriptzeilen
 * mit zwei Modell-Kits vertonen und vergleichen. Als .ts mit createElement,
 * weil vitest nur tests/**\/*.test.ts einsammelt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { PodcastVoiceLab, buildPresets, longestLines, resultKey, scriptLangOf, type VoiceLabSettings } from '@/components/admin/podcast-voice-lab'
import { VOICE_LAB_SAMPLE_SCRIPTS } from '@/lib/tts/voice-lab-samples'
import { DEFAULT_GEMINI_VOICES } from '@/lib/tts/gemini-voices'
import { parseScriptText } from '@/lib/tts/elevenlabs-tts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SCRIPT = `HOST: [indignant, speaking fast] Nvidia is lending money to its own customers.
GUEST: [booming, emphatic] Lend them the money, book the sale, report the quarter.
HOST: Yeah.
GUEST: Fine. [chuckles] You got me there.
HOST: [sharp, fast, cutting in] Okay. Something dumber.
GUEST: [slow and sincere] I was wrong about that one.
HOST: Seventh line, not selected by default.`

const settings: VoiceLabSettings = {
  provider: 'openai',
  openaiModel: 'tts-1-hd',
  openaiHost: 'shimmer',
  openaiGuest: 'fable',
  geminiModel: 'gemini-3.8-flash-tts',
  geminiVoices: DEFAULT_GEMINI_VOICES,
}

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const LIBRARY = [
  { id: 'de-DE-Lena', display_name: 'Lena', gender: 'female', language_code: 'de-DE', accent: 'Hochdeutsch', description: 'warm, ruhig' },
  { id: 'de-DE-Jonas', display_name: 'Jonas', gender: 'male', language_code: 'de-DE' },
]

async function render(currentScript = SCRIPT) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('voices=')) {
      return json({ languageCode: 'de-DE', voices: LIBRARY.map((v) => ({ id: v.id, name: v.display_name, gender: v.gender, languageCodes: [v.language_code], accent: v.accent ?? null, description: v.description ?? null })) })
    }
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      return json({
        audioBase64: btoa('RIFFdata'),
        contentType: body.provider === 'gemini' ? 'audio/wav' : 'audio/mpeg',
        durationSec: 2.5,
        ms: 1200,
        delivery: { text: 'x', direction: null, mode: 'none' },
      })
    }
    void input
    return json({ scripts: [{ postId: '11111111-1111-1111-1111-111111111111', locale: 'en', title: 'Nvidia-Drama', createdAt: '2026-11-15T06:00:00Z', durationSeconds: 980, lines: 120 }] })
  })
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(h(PodcastVoiceLab, { currentScript, settings })) })
  await act(async () => { await Promise.resolve() })
  return fetchMock
}

describe('PodcastVoiceLab', () => {
  it('zeigt die Zeilen des aktuellen Skripts mit Sprecher und Anweisung, die ersten sechs gewählt', async () => {
    const fetchMock = await render()
    const urls = fetchMock.mock.calls.map(([u]) => String(u))
    expect(urls).toContain('/api/admin/podcast-voice-lab')
    expect(urls).toContain('/api/admin/podcast-voice-lab?voices=de-DE')
    const text = container!.textContent ?? ''
    expect(text).toContain('Stimmtest')
    expect(text).toContain('[indignant, speaking fast]')
    expect(text).toContain('Synthesizer')
    expect(text).toContain('6 von 7 Zeilen gewählt')
    const boxes = [...container!.querySelectorAll('button[role="checkbox"]')]
    expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true', 'true', 'true', 'true', 'false'])
    // Kit A = Live-Besetzung (OpenAI tts-1-hd), Kit B = Gemini 3.8 Flash
    expect(text).toContain('Anweisung entfernt (Modell versteht keine)')
    expect(text).toContain('style: „indignant, speaking fast“')
  })

  it('vertont die gewählten Zeilen mit Kit B über Gemini, je Sprecher die Stimme des Kits', async () => {
    const fetchMock = await render()
    const renderButtons = [...container!.querySelectorAll('button')].filter((b) => b.textContent?.includes('Zeilen vertonen'))
    expect(renderButtons).toHaveLength(2)
    await act(async () => { renderButtons[1].click() })
    // Bis alle sechs Zeilen vertont sind (zwei parallele Aufrufe je Kit)
    for (let i = 0; i < 50 && ((container!.textContent ?? '').match(/2\.5 s/g) ?? []).length < 6; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    }

    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)))
    expect(posts).toHaveLength(6)
    expect(posts.every((b) => b.provider === 'gemini' && b.model === 'gemini-3.8-flash-tts' && b.withDirection === true)).toBe(true)
    expect(posts.find((b) => b.text.startsWith('[indignant'))?.voice).toBe(DEFAULT_GEMINI_VOICES.en.host)
    expect(posts.find((b) => b.text.startsWith('[booming'))?.voice).toBe(DEFAULT_GEMINI_VOICES.en.guest)
    expect((container!.textContent ?? '').match(/2\.5 s/g)).toHaveLength(6)
  })
})

describe('Deutsch im Stimmtest', () => {
  it('zeigt die geladene Stimmbibliothek de-DE mit Geschlechtern an', async () => {
    await render()
    expect(container!.textContent).toContain('Stimmbibliothek de-DE: 2 Stimmen (1 weiblich, 1 männlich)')
  })

  it('erkennt ein deutsches Skript und stellt den Test auf Deutsch', async () => {
    await render(VOICE_LAB_SAMPLE_SCRIPTS.de)
    const langTrigger = container!.querySelector('button[aria-label="Sprache des Tests"]')
    expect(langTrigger?.textContent).toContain('Deutsch')
    expect(container!.textContent).toContain('Nvidia leiht genau den Firmen Geld')
    expect(container!.textContent).not.toContain('Das gewählte Skript ist englisch')
  })
})

describe('Hilfsfunktionen', () => {
  it('Beispielskripte: gleicher Aufbau, Sprache wird erkannt', () => {
    const de = parseScriptText(VOICE_LAB_SAMPLE_SCRIPTS.de)
    const en = parseScriptText(VOICE_LAB_SAMPLE_SCRIPTS.en)
    expect(de).toHaveLength(12)
    expect(de.map((l) => l.speaker)).toEqual(en.map((l) => l.speaker))
    expect(de.map((l) => !!l.overlapping)).toEqual(en.map((l) => !!l.overlapping))
    expect(scriptLangOf(VOICE_LAB_SAMPLE_SCRIPTS.de)).toBe('de')
    expect(scriptLangOf(VOICE_LAB_SAMPLE_SCRIPTS.en)).toBe('en')
    expect(scriptLangOf(SCRIPT)).toBe('en')
  })

  it('Vorlagen: Live-Besetzung zuerst, Gemini mit der Besetzung der Sprache', () => {
    const presets = buildPresets({ ...settings, geminiVoices: { de: { host: 'Puck', guest: 'Algenib' }, en: DEFAULT_GEMINI_VOICES.en } }, 'de')
    expect(presets[0]).toMatchObject({ id: 'live', kit: { provider: 'openai', model: 'tts-1-hd', host: 'shimmer', guest: 'fable' } })
    expect(presets.find((p) => p.id === 'gemini-lite')?.kit).toEqual({ provider: 'gemini', model: 'gemini-3.8-flash-lite-tts', host: 'Puck', guest: 'Algenib' })
  })

  it('Cache-Schlüssel hängt an Stimme, Modell und Anweisungs-Schalter; Monologe zuerst', () => {
    const lines = parseScriptText(SCRIPT)
    const kit = { provider: 'gemini' as const, model: 'gemini-3.8-flash-tts', host: 'Kore', guest: 'Charon' }
    expect(resultKey(kit, lines[0], true)).not.toBe(resultKey(kit, lines[0], false))
    expect(resultKey(kit, lines[0], true)).not.toBe(resultKey({ ...kit, host: 'Puck' }, lines[0], true))
    expect(resultKey(kit, lines[1], true)).toBe(resultKey({ ...kit, host: 'Puck' }, lines[1], true)) // GUEST-Zeile
    expect(longestLines(lines, 2)).toEqual([0, 1])
  })
})
