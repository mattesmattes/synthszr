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

export type VoiceGender = 'female' | 'male' | 'neutral'

export const GENDER_LABEL: Record<VoiceGender, string> = {
  female: 'weiblich',
  male: 'männlich',
  neutral: 'neutral',
}

export interface GeminiVoice {
  id: string
  /** Kurzbeschreibung aus Googles Liste, übersetzt. */
  label: string
  gender: VoiceGender
}

/**
 * Die 30 vorgefertigten Stimmen (Googles Kurzbeschreibung in Klammern).
 * Geschlecht laut Google Cloud „Chirp 3: HD voices“ (dieselben 30 Namen,
 * Stand 2026-11-16): 14 weiblich, 16 männlich. Alle sprechen jede
 * unterstützte Sprache, auch Deutsch; für Deutsch abgestimmt sind sie nicht.
 */
export const GEMINI_TTS_VOICES: GeminiVoice[] = [
  { id: 'Zephyr', label: 'hell (Bright)', gender: 'female' },
  { id: 'Puck', label: 'beschwingt (Upbeat)', gender: 'male' },
  { id: 'Charon', label: 'informativ (Informative)', gender: 'male' },
  { id: 'Kore', label: 'bestimmt (Firm)', gender: 'female' },
  { id: 'Fenrir', label: 'erregbar (Excitable)', gender: 'male' },
  { id: 'Leda', label: 'jugendlich (Youthful)', gender: 'female' },
  { id: 'Orus', label: 'bestimmt (Firm)', gender: 'male' },
  { id: 'Aoede', label: 'luftig (Breezy)', gender: 'female' },
  { id: 'Callirrhoe', label: 'locker (Easy-going)', gender: 'female' },
  { id: 'Autonoe', label: 'hell (Bright)', gender: 'female' },
  { id: 'Enceladus', label: 'hauchig (Breathy)', gender: 'male' },
  { id: 'Iapetus', label: 'klar (Clear)', gender: 'male' },
  { id: 'Umbriel', label: 'locker (Easy-going)', gender: 'male' },
  { id: 'Algieba', label: 'weich (Smooth)', gender: 'male' },
  { id: 'Despina', label: 'weich (Smooth)', gender: 'female' },
  { id: 'Erinome', label: 'klar (Clear)', gender: 'female' },
  { id: 'Algenib', label: 'rau (Gravelly)', gender: 'male' },
  { id: 'Rasalgethi', label: 'informativ (Informative)', gender: 'male' },
  { id: 'Laomedeia', label: 'beschwingt (Upbeat)', gender: 'female' },
  { id: 'Achernar', label: 'sanft (Soft)', gender: 'female' },
  { id: 'Alnilam', label: 'bestimmt (Firm)', gender: 'male' },
  { id: 'Schedar', label: 'gleichmäßig (Even)', gender: 'male' },
  { id: 'Gacrux', label: 'reif (Mature)', gender: 'female' },
  { id: 'Pulcherrima', label: 'nach vorn (Forward)', gender: 'female' },
  { id: 'Achird', label: 'freundlich (Friendly)', gender: 'male' },
  { id: 'Zubenelgenubi', label: 'lässig (Casual)', gender: 'male' },
  { id: 'Vindemiatrix', label: 'behutsam (Gentle)', gender: 'female' },
  { id: 'Sadachbia', label: 'lebhaft (Lively)', gender: 'male' },
  { id: 'Sadaltager', label: 'kundig (Knowledgeable)', gender: 'male' },
  { id: 'Sulafat', label: 'warm (Warm)', gender: 'female' },
]

const VOICE_IDS = new Set(GEMINI_TTS_VOICES.map((v) => v.id))

/** Eine der 30 vorgefertigten Stimmen. */
export function isGeminiVoice(id: unknown): id is string {
  return typeof id === 'string' && VOICE_IDS.has(id)
}

/**
 * Stimme aus der erweiterten Bibliothek (GET /v1beta/voices), z. B. für
 * de-DE. Google dokumentiert nicht, wie ihre ID im Aufruf steht; wir geben
 * sie wie die vorgefertigten Namen im Feld `voice` mit (wie eigene
 * Stimmen `voice_…`). Erlaubt sind nur unverdächtige Zeichen.
 */
const LIBRARY_VOICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/

/** Vorgefertigte Stimme oder Bibliotheks-ID: was Job, Einstellungen und Stimmtest annehmen. */
export function isGeminiVoiceId(id: unknown): id is string {
  return typeof id === 'string' && (VOICE_IDS.has(id) || LIBRARY_VOICE_ID_RE.test(id))
}

/** Eintrag der erweiterten Stimmbibliothek, normalisiert. */
export interface GeminiLibraryVoice {
  id: string
  name: string
  gender: VoiceGender | null
  languageCodes: string[]
  accent: string | null
  description: string | null
}

export const GEMINI_LIBRARY_LANGUAGE = 'de-DE'

/** Text für ein Pull-down: „Kore – bestimmt (Firm) · weiblich“. */
export function geminiVoiceLabel(voice: GeminiVoice): string {
  return `${voice.id} – ${voice.label} · ${GENDER_LABEL[voice.gender]}`
}

/** Text für eine Bibliotheksstimme: „Name · weiblich · Akzent – Beschreibung“. */
export function libraryVoiceLabel(voice: GeminiLibraryVoice): string {
  const parts = [voice.name]
  if (voice.gender) parts.push(GENDER_LABEL[voice.gender])
  if (voice.accent) parts.push(voice.accent)
  const head = parts.join(' · ')
  const desc = voice.description?.trim()
  return desc ? `${head} – ${desc.length > 60 ? `${desc.slice(0, 57)}…` : desc}` : head
}

export interface VoiceOption {
  id: string
  label: string
}

export interface VoiceOptionGroup {
  label: string
  options: VoiceOption[]
}

/**
 * Gruppen für die Gemini-Pull-downs: die 30 Standardstimmen (weiblich,
 * dann männlich) und die Bibliothek der Sprache. Eine gespeicherte Stimme,
 * die in keiner Liste steht (Bibliothek nicht geladen), bleibt wählbar.
 */
export function geminiVoiceGroups(library: GeminiLibraryVoice[], current: string[] = []): VoiceOptionGroup[] {
  const byGender = (g: VoiceGender) => GEMINI_TTS_VOICES.filter((v) => v.gender === g).map((v) => ({ id: v.id, label: geminiVoiceLabel(v) }))
  const groups: VoiceOptionGroup[] = [
    { label: 'Standardstimmen, weiblich (alle Sprachen)', options: byGender('female') },
    { label: 'Standardstimmen, männlich (alle Sprachen)', options: byGender('male') },
  ]
  const libraryOptions = library.filter((v) => !VOICE_IDS.has(v.id)).map((v) => ({ id: v.id, label: libraryVoiceLabel(v) }))
  if (libraryOptions.length > 0) {
    groups.push({ label: `Stimmbibliothek ${GEMINI_LIBRARY_LANGUAGE}`, options: libraryOptions })
  }
  const known = new Set(groups.flatMap((g) => g.options.map((o) => o.id)))
  const missing = [...new Set(current)].filter((id) => id && !known.has(id))
  if (missing.length > 0) {
    groups.push({ label: 'Gespeichert', options: missing.map((id) => ({ id, label: id })) })
  }
  return groups
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
