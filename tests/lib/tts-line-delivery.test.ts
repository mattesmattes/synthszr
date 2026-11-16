/**
 * Wie eine Skriptzeile bei der Sprachsynthese ankommt (lib/tts/line-delivery.ts).
 *
 * OpenAI bleibt Byte für Byte wie bis 2026-11-16 im Audio-Job; Gemini bekommt
 * die Anweisung am Zeilenanfang als style und Laute/Pausen als Inline-Tags,
 * weil Gemini den Text wörtlich vorliest (Betreiber 2026-11-16).
 */
import { describe, expect, it } from 'vitest'
import {
  describeDelivery,
  isSpeakable,
  isVocalCue,
  prepareLineForTTS,
  SCRIPT_VOCAL_CUES,
  spokenText,
  toGeminiInlineTags,
} from '@/lib/tts/line-delivery'
import { emotionToInstruction, extractEmotionTag, stripDirectiveTags, stripEmotionTags } from '@/lib/tts/elevenlabs-tts'

/** Die Logik, die bis 2026-11-16 im Audio-Job stand (generateSegmentOpenAI). */
function legacyOpenAI(lineText: string, model: string) {
  const prepare = (t: string) => t.replaceAll('Synthszr', 'Synthesizer').replaceAll('synthszr', 'synthesizer').replaceAll('SYNTHSZR', 'SYNTHESIZER')
  const text = stripDirectiveTags(lineText)
  if (model === 'gpt-4o-mini-tts') {
    const { emotion, cleanText } = extractEmotionTag(text)
    return { text: prepare(stripEmotionTags(cleanText)), instructions: emotionToInstruction(emotion) }
  }
  return { text: prepare(stripEmotionTags(text)), instructions: undefined }
}

const SAMPLES = [
  '[dry, quick] Synthszr says the board slept through it.',
  '[beat] Well... [grave, slow] that is the part I do not buy.',
  'Plain line without a direction.',
  '[cheerfully] Hello there!',
  '[short pause]',
]

describe('prepareLineForTTS: OpenAI unverändert', () => {
  it.each(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'])('%s liefert denselben Text und dieselben instructions wie bisher', (model) => {
    for (const line of SAMPLES) {
      const legacy = legacyOpenAI(line, model)
      const now = prepareLineForTTS({ provider: 'openai', model, text: line })
      expect(now.text, line).toBe(legacy.text)
      expect(now.instructions, line).toBe(legacy.instructions)
    }
  })

  it('kennzeichnet, wie die Anweisung ankommt', () => {
    expect(prepareLineForTTS({ provider: 'openai', model: 'tts-1-hd', text: '[dry] Hi.' }).mode).toBe('stripped')
    expect(prepareLineForTTS({ provider: 'openai', model: 'gpt-4o-mini-tts', text: '[dry] Hi.' }).mode).toBe('instructions')
    expect(prepareLineForTTS({ provider: 'openai', model: 'gpt-4o-mini-tts', text: 'Hi.' }).mode).toBe('none')
  })
})

describe('prepareLineForTTS: Gemini', () => {
  it('macht die Anweisung am Zeilenanfang zum style und liest den Rest wörtlich', () => {
    const d = prepareLineForTTS({ provider: 'gemini', model: 'gemini-3.8-flash-tts', text: '[indignant, speaking fast] Synthszr is wrong.' })
    expect(d).toEqual({ text: 'Synthesizer is wrong.', style: 'indignant, speaking fast', direction: 'indignant, speaking fast', mode: 'style' })
  })

  it('setzt Laute und Pausen als Inline-Tags an die Stelle und streicht andere Klammern', () => {
    const d = prepareLineForTTS({ provider: 'gemini', model: 'gemini-3.8-flash-tts', text: '[dry] Fine. [chuckles] You got me. [short pause] Next. [points at screen] Done [long pause] now.' })
    expect(d.text).toBe('Fine. <chuckle> You got me. <short pause> Next. Done <long pause> now.')
    expect(d.style).toBe('dry')
  })

  it('behandelt einen Laut am Zeilenanfang als Laut, nicht als style', () => {
    const d = prepareLineForTTS({ provider: 'gemini', model: 'gemini-3.8-flash-tts', text: '[sighs] Fine.' })
    expect(d.text).toBe('<sigh> Fine.')
    expect(d.style).toBeUndefined()
    expect(d.mode).toBe('none')
    // „laughing“ färbt dagegen die ganze Zeile
    expect(prepareLineForTTS({ provider: 'gemini', model: 'gemini-3.8-flash-tts', text: '[laughing, warm] Stop it.' }).style).toBe('laughing, warm')
  })

  it('macht aus den alten Pausen-Tags echte Pausen', () => {
    expect(prepareLineForTTS({ provider: 'gemini', model: 'gemini-3.8-flash-tts', text: '[beat] Well.' }).text).toBe('<short pause> Well.')
    expect(prepareLineForTTS({ provider: 'gemini', model: 'gemini-3.8-flash-tts', text: 'So [longer pause] no.' }).text).toBe('So <long pause> no.')
  })

  it('lässt die Anweisung im Stimmtest auf Wunsch weg', () => {
    const d = prepareLineForTTS({ provider: 'gemini', model: 'gemini-3.8-flash-tts', text: '[dry] Hi.', withDirection: false })
    expect(d.style).toBeUndefined()
    expect(d.mode).toBe('none')
    expect(d.direction).toBe('dry')
    expect(describeDelivery(d)).toBe('Anweisung abgeschaltet')
  })

  it('erkennt Zeilen ohne gesprochenen Text', () => {
    expect(isSpeakable(prepareLineForTTS({ provider: 'gemini', model: 'gemini-3.8-flash-tts', text: '[short pause]' }))).toBe(false)
    expect(isSpeakable(prepareLineForTTS({ provider: 'gemini', model: 'gemini-3.8-flash-tts', text: '[waiting]' }))).toBe(false)
    expect(isSpeakable(prepareLineForTTS({ provider: 'openai', model: 'tts-1-hd', text: '[pondering]' }))).toBe(false)
    expect(isSpeakable(prepareLineForTTS({ provider: 'gemini', model: 'gemini-3.8-flash-tts', text: 'Yes. [laughs]' }))).toBe(true)
  })
})

describe('Laut-Hinweise', () => {
  it('kennt jeden Hinweis, den die Skript-Prompts erlauben, als Gemini-Tag', () => {
    for (const cue of SCRIPT_VOCAL_CUES) {
      expect(isVocalCue(cue), cue).toBe(true)
      expect(toGeminiInlineTags(`a [${cue}] b`), cue).toMatch(/^a <[a-z -]+> b$/)
    }
    expect(isVocalCue('dry, quick')).toBe(false)
    expect(spokenText('a <laugh> b')).toBe('a b')
  })
})
