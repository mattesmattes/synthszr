/**
 * Gemini-Stimmen im Podcast Studio (Betreiber 2026-11-16): Geschlecht in den
 * Pull-downs, de-DE-Stimmbibliothek, Bibliotheks-IDs in Job und Einstellungen.
 * Geschlecht laut Google Cloud „Chirp 3: HD voices“ (dieselben 30 Namen).
 */
import { describe, expect, it } from 'vitest'
import {
  GEMINI_TTS_VOICES,
  geminiVoiceGroups,
  geminiVoiceLabel,
  isGeminiVoice,
  isGeminiVoiceId,
  libraryVoiceLabel,
  type GeminiLibraryVoice,
} from '@/lib/tts/gemini-voices'

const lena: GeminiLibraryVoice = { id: 'de-DE-Lena', name: 'Lena', gender: 'female', languageCodes: ['de-DE'], accent: 'Hochdeutsch', description: 'warm, ruhig' }
const jonas: GeminiLibraryVoice = { id: 'voices/jonas-01', name: 'Jonas', gender: 'male', languageCodes: ['de-DE'], accent: null, description: null }

describe('Standardstimmen', () => {
  it('führen 30 Stimmen mit Geschlecht: 14 weiblich, 16 männlich', () => {
    expect(GEMINI_TTS_VOICES).toHaveLength(30)
    expect(GEMINI_TTS_VOICES.filter((v) => v.gender === 'female')).toHaveLength(14)
    expect(GEMINI_TTS_VOICES.filter((v) => v.gender === 'male')).toHaveLength(16)
    const byId = Object.fromEntries(GEMINI_TTS_VOICES.map((v) => [v.id, v.gender]))
    expect(byId.Kore).toBe('female')
    expect(byId.Charon).toBe('male')
    expect(byId.Pulcherrima).toBe('female')
    expect(byId.Zubenelgenubi).toBe('male')
  })

  it('zeigen das Geschlecht im Pull-down-Text', () => {
    expect(geminiVoiceLabel(GEMINI_TTS_VOICES.find((v) => v.id === 'Kore')!)).toBe('Kore – bestimmt (Firm) · weiblich')
    expect(geminiVoiceLabel(GEMINI_TTS_VOICES.find((v) => v.id === 'Charon')!)).toBe('Charon – informativ (Informative) · männlich')
  })
})

describe('Stimmbibliothek', () => {
  it('beschriftet Bibliotheksstimmen mit Name, Geschlecht, Akzent und Beschreibung', () => {
    expect(libraryVoiceLabel(lena)).toBe('Lena · weiblich · Hochdeutsch – warm, ruhig')
    expect(libraryVoiceLabel(jonas)).toBe('Jonas · männlich')
  })

  it('gruppiert weiblich, männlich und Bibliothek; eine gespeicherte unbekannte Stimme bleibt wählbar', () => {
    const groups = geminiVoiceGroups([lena, jonas, { ...lena, id: 'Kore' }], ['Kore', 'voice_custom_1'])
    expect(groups.map((g) => g.label)).toEqual([
      'Standardstimmen, weiblich (alle Sprachen)',
      'Standardstimmen, männlich (alle Sprachen)',
      'Stimmbibliothek de-DE',
      'Gespeichert',
    ])
    expect(groups[2].options.map((o) => o.id)).toEqual(['de-DE-Lena', 'voices/jonas-01']) // Kore steht schon bei den Standardstimmen
    expect(groups[3].options).toEqual([{ id: 'voice_custom_1', label: 'voice_custom_1' }])
    expect(geminiVoiceGroups([])).toHaveLength(2)
  })

  it('nimmt Bibliotheks-IDs an, aber nichts Verdächtiges', () => {
    expect(isGeminiVoice('voices/jonas-01')).toBe(false)
    for (const id of ['Kore', 'de-DE-Lena', 'voices/jonas-01', 'voice_abc123', 'voicekey_xyz']) expect(isGeminiVoiceId(id), id).toBe(true)
    for (const id of ['', ' Kore', '../etc', 'a b', '<script>', 'x'.repeat(200), 42, null]) expect(isGeminiVoiceId(id), String(id)).toBe(false)
  })
})
