/**
 * Wie eine Skriptzeile bei der Sprachsynthese ankommt, je Anbieter und
 * Modell. Einzige Stelle für diese Umsetzung: Audio-Job
 * (`app/api/podcast/jobs/process`) und Stimmtest (Podcast Studio) nutzen
 * sie gleich, damit der Test genau das spielt, was in der Folge landet.
 *
 * Skriptformat: `[Sprechanweisung] Text`, die Anweisung am Zeilenanfang
 * (Befund 2026-11-16: 100 % der Zeilen der letzten acht Folgen tragen eine,
 * mitten in der Zeile stand nur zweimal „[beat]“).
 *
 * - OpenAI gpt-4o-mini-tts: Anweisung → `instructions`, weitere Klammern weg.
 * - OpenAI tts-1 / tts-1-hd: alle Anweisungen weg (verstehen keine).
 * - Gemini 3.8 Flash (Lite) TTS: Anweisung → `speech_metadata.style`
 *   (Googles Feld für Gefühl, Tempo und Lautstärke eines ganzen Turns);
 *   Pausen und Laute mitten im Satz werden zu Geminis Inline-Tags
 *   (`<short pause>`, `<laugh>` …), alles andere in Klammern fällt weg, weil
 *   Gemini den Text wörtlich vorliest.
 *
 * Reine Funktionen ohne Server-Abhängigkeit (auch im Browser nutzbar).
 */

import {
  emotionToInstruction,
  extractEmotionTag,
  stripDirectiveTags,
  stripEmotionTags,
} from '@/lib/tts/elevenlabs-tts'

export type TTSProviderId = 'openai' | 'gemini'

export type DirectionMode =
  /** gpt-4o-mini-tts: Anweisung geht als `instructions` mit. */
  | 'instructions'
  /** Gemini: Anweisung geht als `style` mit. */
  | 'style'
  /** tts-1 / tts-1-hd: das Modell versteht keine Anweisung, sie fällt weg. */
  | 'stripped'
  /** Keine Anweisung (Zeile ohne oder im Stimmtest abgeschaltet). */
  | 'none'

export interface LineDelivery {
  /** Text, wie er an die Sprachsynthese geht. */
  text: string
  /** OpenAI gpt-4o-mini-tts */
  instructions?: string
  /** Gemini `speech_metadata.style` */
  style?: string
  /** Anweisung am Zeilenanfang, wie sie im Skript steht. */
  direction: string | null
  mode: DirectionMode
}

/** Aussprache-Ersetzungen (wie bisher im Audio-Job). */
const TTS_PRONUNCIATIONS: Record<string, string> = {
  Synthszr: 'Synthesizer',
  synthszr: 'synthesizer',
  SYNTHSZR: 'SYNTHESIZER',
}

export function applyPronunciations(text: string): string {
  let result = text
  for (const [from, to] of Object.entries(TTS_PRONUNCIATIONS)) {
    result = result.replaceAll(from, to)
  }
  return result
}

/**
 * Laute und Pausen, die das Skript an der Stelle setzen darf, an der sie
 * passieren (Skript-Prompts, Texturprüfung und diese Umsetzung nutzen dieselbe
 * Liste). Gemini macht daraus echte Laute, OpenAI bekommt sie nicht zu sehen.
 */
export const SCRIPT_VOCAL_CUES = ['laughs', 'chuckles', 'sighs', 'gasps', 'breath', 'short pause', 'long pause'] as const

/**
 * Klammer-Hinweise mitten in der Zeile → Geminis Inline-Tags (Liste aus der
 * Google-Doku „Speech generation“; die Doku empfiehlt englische Tags auch in
 * nicht-englischen Texten). Neben den Skript-Hinweisen oben auch Varianten,
 * die Modelle trotzdem schreiben.
 */
const GEMINI_INLINE_TAGS: Array<[RegExp, string]> = [
  [/^(beat|pause|short pause|brief pause)$/, '<short pause>'],
  [/^(long pause|longer pause)$/, '<long pause>'],
  [/^(laugh|laughs|laughing|laughter)$/, '<laugh>'],
  [/^(chuckle|chuckles|chuckling)$/, '<chuckle>'],
  [/^(giggle|giggles|giggling)$/, '<giggle>'],
  [/^(sigh|sighs|sighing)$/, '<sigh>'],
  [/^(gasp|gasps|gasping)$/, '<gasp>'],
  [/^(breath|breathes|inhales|deep breath)$/, '<breath>'],
  [/^(exhale|exhales|exhaling)$/, '<exhales>'],
  [/^(snort|snorts)$/, '<snort>'],
  [/^(cough|coughs)$/, '<cough>'],
  [/^(groan|groans)$/, '<groan>'],
  [/^(clears throat|throat clearing|throat-clearing)$/, '<throat-clearing>'],
]

function geminiTagFor(cue: string): string | null {
  const key = cue.toLowerCase().trim()
  for (const [pattern, tag] of GEMINI_INLINE_TAGS) {
    if (pattern.test(key)) return tag
  }
  return null
}

/** Ist der Klammerinhalt ein Laut oder eine Pause (statt einer Sprechanweisung)? */
export function isVocalCue(cue: string): boolean {
  return geminiTagFor(cue) !== null
}

const LINE_START_CUES = new Set<string>(SCRIPT_VOCAL_CUES)

/** Klammern mitten im Text: bekannte Laute/Pausen → Inline-Tag, Rest weg. */
export function toGeminiInlineTags(text: string): string {
  return text
    .replace(/\s*\[([^\]]*)\]\s*/g, (_match, cue: string) => {
      const tag = geminiTagFor(cue)
      return tag ? ` ${tag} ` : ' '
    })
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Was tatsächlich gesprochen wird (ohne Inline-Tags in spitzen Klammern). */
export function spokenText(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

export function isSpeakable(delivery: LineDelivery): boolean {
  return spokenText(delivery.text).length > 0
}

export interface PrepareLineInput {
  provider: TTSProviderId
  model: string
  /** Zeilentext aus dem Skript, ohne „HOST:“/„GUEST:“. */
  text: string
  /** Stimmtest: Anweisung weglassen (Googles Rat: erst ohne style testen). */
  withDirection?: boolean
}

export function prepareLineForTTS({ provider, model, text, withDirection = true }: PrepareLineInput): LineDelivery {
  if (provider === 'gemini') {
    // Anweisung zuerst abtrennen: „[beat] Text“ am Zeilenanfang ist eine
    // Pause, keine Anweisung (extractEmotionTag überspringt Pausen-Tags).
    const extracted = extractEmotionTag(text.trim())
    // „[sighs] Fine.“: ein Laut am Zeilenanfang bleibt ein Laut an der Stelle;
    // „[laughing, warm]“ dagegen färbt die ganze Zeile und wird zum style.
    const cueAtStart = extracted.emotion !== null && LINE_START_CUES.has(extracted.emotion.toLowerCase())
    const emotion = cueAtStart ? null : extracted.emotion
    const body = cueAtStart ? text.trim() : extracted.cleanText
    const style = withDirection && emotion ? emotion : undefined
    return {
      text: applyPronunciations(toGeminiInlineTags(body)),
      ...(style ? { style } : {}),
      direction: emotion,
      mode: style ? 'style' : 'none',
    }
  }

  // OpenAI: unverändert gegenüber dem Audio-Job bis 2026-11-16.
  const withoutDirectives = stripDirectiveTags(text)
  if (model === 'gpt-4o-mini-tts') {
    const { emotion, cleanText } = extractEmotionTag(withoutDirectives)
    // Nur die erste Anweisung wird zu instructions; weitere Klammern mitten im
    // Satz würden sonst mitgesprochen.
    const useDirection = withDirection ? emotion : null
    return {
      text: applyPronunciations(stripEmotionTags(cleanText)),
      instructions: emotionToInstruction(useDirection),
      direction: emotion,
      mode: useDirection ? 'instructions' : 'none',
    }
  }
  const { emotion } = extractEmotionTag(withoutDirectives)
  return {
    text: applyPronunciations(stripEmotionTags(withoutDirectives)),
    direction: emotion,
    mode: emotion ? 'stripped' : 'none',
  }
}

/** Kurzbeschreibung für den Stimmtest: wie die Anweisung beim Modell ankommt. */
export function describeDelivery(delivery: LineDelivery): string {
  switch (delivery.mode) {
    case 'style':
      return `style: „${delivery.style}“`
    case 'instructions':
      return `instructions: „${delivery.instructions}“`
    case 'stripped':
      return 'Anweisung entfernt (Modell versteht keine)'
    default:
      return delivery.direction ? 'Anweisung abgeschaltet' : 'keine Anweisung'
  }
}
