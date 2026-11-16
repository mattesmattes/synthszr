/**
 * Gemini-TTS: Modelle, Stimmen und Voreinstellungen (Betreiber 2026-11-16:
 * „Ergänze die Pipelines um Gemini-TTS mit Sprachauswahl und Sprecherauswahl
 * zum Testen“). Hintergrund: OpenAI schaltet tts-1, tts-1-hd und
 * gpt-4o-mini-tts am 6. Januar 2027 ab.
 *
 * Reine Konstanten ohne Server-Abhängigkeiten, damit Admin-Seite und Server
 * dieselbe Liste nutzen. Quelle der Stimmen und Preise: Google AI Studio,
 * „Speech generation“ und „Pricing“ (Stand 2026-11-16).
 */

export const GEMINI_TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'] as const
export type GeminiTTSModel = (typeof GEMINI_TTS_MODELS)[number]
export const DEFAULT_GEMINI_TTS_MODEL: GeminiTTSModel = 'gemini-3.8-flash-tts'

export type PodcastTTSProvider = 'openai' | 'gemini'
export type PodcastTTSLang = 'de' | 'en'

export interface GeminiVoice {
  id: string
  /** Kurzbeschreibung aus Googles Liste, übersetzt. */
  label: string
}

/** Die 30 vorgefertigten Stimmen (Googles Kurzbeschreibung in Klammern). */
export const GEMINI_TTS_VOICES: GeminiVoice[] = [
  { id: 'Zephyr', label: 'hell (Bright)' },
  { id: 'Puck', label: 'beschwingt (Upbeat)' },
  { id: 'Charon', label: 'informativ (Informative)' },
  { id: 'Kore', label: 'bestimmt (Firm)' },
  { id: 'Fenrir', label: 'erregbar (Excitable)' },
  { id: 'Leda', label: 'jugendlich (Youthful)' },
  { id: 'Orus', label: 'bestimmt (Firm)' },
  { id: 'Aoede', label: 'luftig (Breezy)' },
  { id: 'Callirrhoe', label: 'locker (Easy-going)' },
  { id: 'Autonoe', label: 'hell (Bright)' },
  { id: 'Enceladus', label: 'hauchig (Breathy)' },
  { id: 'Iapetus', label: 'klar (Clear)' },
  { id: 'Umbriel', label: 'locker (Easy-going)' },
  { id: 'Algieba', label: 'weich (Smooth)' },
  { id: 'Despina', label: 'weich (Smooth)' },
  { id: 'Erinome', label: 'klar (Clear)' },
  { id: 'Algenib', label: 'rau (Gravelly)' },
  { id: 'Rasalgethi', label: 'informativ (Informative)' },
  { id: 'Laomedeia', label: 'beschwingt (Upbeat)' },
  { id: 'Achernar', label: 'sanft (Soft)' },
  { id: 'Alnilam', label: 'bestimmt (Firm)' },
  { id: 'Schedar', label: 'gleichmäßig (Even)' },
  { id: 'Gacrux', label: 'reif (Mature)' },
  { id: 'Pulcherrima', label: 'nach vorn (Forward)' },
  { id: 'Achird', label: 'freundlich (Friendly)' },
  { id: 'Zubenelgenubi', label: 'lässig (Casual)' },
  { id: 'Vindemiatrix', label: 'behutsam (Gentle)' },
  { id: 'Sadachbia', label: 'lebhaft (Lively)' },
  { id: 'Sadaltager', label: 'kundig (Knowledgeable)' },
  { id: 'Sulafat', label: 'warm (Warm)' },
]

const VOICE_IDS = new Set(GEMINI_TTS_VOICES.map((v) => v.id))

export function isGeminiVoice(id: unknown): id is string {
  return typeof id === 'string' && VOICE_IDS.has(id)
}

export function isGeminiTTSModel(model: unknown): model is GeminiTTSModel {
  return typeof model === 'string' && (GEMINI_TTS_MODELS as readonly string[]).includes(model)
}

/** Startbesetzung, bis im Podcast Studio etwas anderes gespeichert ist. */
export const DEFAULT_GEMINI_VOICES: Record<PodcastTTSLang, { host: string; guest: string }> = {
  de: { host: 'Kore', guest: 'Charon' },
  en: { host: 'Kore', guest: 'Charon' },
}

/** Skripte gibt es nur deutsch oder englisch (wie LOCALE_TO_TTS_LANG in generate-script). */
export function ttsLangOf(locale: string | null | undefined): PodcastTTSLang {
  return locale === 'de' ? 'de' : 'en'
}

/**
 * Preis je Folge zur Orientierung im Podcast Studio (rund 16–17 Minuten
 * Audio, 25 Audio-Tokens je Sekunde; Listenpreis je 1 Mio. Audio-Tokens).
 * Google verdoppelt die Preise zum 1. Januar 2027.
 */
export const GEMINI_TTS_PRICE_HINT: Record<GeminiTTSModel, string> = {
  'gemini-3.8-flash-tts': '≈ 0,23 USD je Folge bis 31.12.2026, danach ≈ 0,46 USD',
  'gemini-3.8-flash-lite-tts': '≈ 0,15 USD je Folge bis 31.12.2026, danach ≈ 0,30 USD',
}

/** Kurzer Probetext je Sprache für die Stimmprobe. */
export const GEMINI_PREVIEW_TEXT: Record<PodcastTTSLang, { host: string; guest: string }> = {
  de: {
    host: 'Hey, hey und willkommen bei Synthesizer Daily! Und heute fange ich an, weil mir eine Meldung wirklich die Laune verdorben hat.',
    guest: 'Lass mich kurz ausholen: Wer hier gewinnt, ist nicht der mit dem besten Modell, sondern der mit der dicksten Rechnung im Rücken.',
  },
  en: {
    host: 'Hey, hey and welcome to Synthesizer Daily! And I am going first today, because one story genuinely ruined my morning.',
    guest: 'Let me zoom out for a second: the winner here is not the one with the best model, it is the one with the deepest pockets.',
  },
}
