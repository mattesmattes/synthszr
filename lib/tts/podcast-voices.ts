/**
 * Auswahllisten für das Podcast Studio (Aufnahme-Tab und Stimmtest), ohne
 * Server-Abhängigkeiten. OpenAI-Stimmen wie bisher auf der Admin-Seite;
 * ballad, verse, marin und cedar gibt es nur mit gpt-4o-mini-tts.
 */

export const OPENAI_TTS_MODELS = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'] as const
export type OpenAITTSModelId = (typeof OPENAI_TTS_MODELS)[number]

export const OPENAI_PODCAST_VOICES: Array<{ id: string; name: string; description: string }> = [
  { id: 'nova', name: 'Nova', description: 'Warm, engaging female' },
  { id: 'shimmer', name: 'Shimmer', description: 'Expressive female' },
  { id: 'alloy', name: 'Alloy', description: 'Balanced, neutral' },
  { id: 'echo', name: 'Echo', description: 'Warm male' },
  { id: 'fable', name: 'Fable', description: 'British accent' },
  { id: 'onyx', name: 'Onyx', description: 'Deep, authoritative male' },
  { id: 'coral', name: 'Coral', description: 'Warm, expressive' },
  { id: 'ash', name: 'Ash', description: 'Clear, direct' },
  { id: 'sage', name: 'Sage', description: 'Calm, composed' },
  { id: 'ballad', name: 'Ballad', description: 'Melodic, storytelling' },
  { id: 'verse', name: 'Verse', description: 'Versatile, dynamic' },
  { id: 'marin', name: 'Marin', description: 'Warm, recommended' },
  { id: 'cedar', name: 'Cedar', description: 'Natural, recommended' },
]

export const OPENAI_MODEL_LABELS: Record<OpenAITTSModelId, string> = {
  'gpt-4o-mini-tts': 'gpt-4o-mini-tts (Sprechanweisungen)',
  'tts-1': 'tts-1 (schnell, günstiger)',
  'tts-1-hd': 'tts-1-hd (HD Qualität)',
}

export const GEMINI_MODEL_LABELS: Record<string, string> = {
  'gemini-3.8-flash-tts': 'Gemini 3.8 Flash TTS',
  'gemini-3.8-flash-lite-tts': 'Gemini 3.8 Flash Lite TTS',
}
