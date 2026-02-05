'use client'

import { useEffect, useState, useRef } from 'react'
import { Volume2, Mic, CheckCircle, Loader2, Save, Play, AlertTriangle, Info, Pause, Sparkles, Clock, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'

// Types
type TTSVoice = 'alloy' | 'echo' | 'fable' | 'nova' | 'onyx' | 'shimmer'
type TTSModel = 'tts-1' | 'tts-1-hd'
type TTSProvider = 'openai' | 'elevenlabs'
type ElevenLabsModel = 'eleven_multilingual_v2' | 'eleven_turbo_v2_5' | 'eleven_turbo_v2'

interface TTSSettings {
  tts_provider: TTSProvider
  tts_news_voice_de: TTSVoice
  tts_news_voice_en: TTSVoice
  tts_synthszr_voice_de: TTSVoice
  tts_synthszr_voice_en: TTSVoice
  tts_model: TTSModel
  tts_enabled: boolean
  // ElevenLabs settings
  elevenlabs_news_voice_en: string
  elevenlabs_synthszr_voice_en: string
  elevenlabs_model: ElevenLabsModel
  // Podcast settings - German voices
  podcast_host_voice_id: string      // Legacy, now used for German
  podcast_guest_voice_id: string     // Legacy, now used for German
  podcast_host_voice_de: string
  podcast_guest_voice_de: string
  // Podcast settings - English voices (used for EN, CS, NDS, etc.)
  podcast_host_voice_en: string
  podcast_guest_voice_en: string
  podcast_duration_minutes: number
  // Podcast script prompt
  podcast_script_prompt: string | null
}

// Supported podcast locales and their TTS language mapping
type PodcastLocale = 'de' | 'en' | 'cs' | 'nds'
const PODCAST_LOCALES: { code: PodcastLocale; name: string; ttsLang: 'de' | 'en' }[] = [
  { code: 'de', name: 'Deutsch', ttsLang: 'de' },
  { code: 'en', name: 'English', ttsLang: 'en' },
  { code: 'cs', name: 'Čeština', ttsLang: 'en' },
  { code: 'nds', name: 'Plattdüütsch', ttsLang: 'en' },
]

// ElevenLabs voice presets for Reading
const ELEVENLABS_VOICES = {
  news: [
    { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Warm, professional female' },
    { id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', description: 'Energetic, youthful female' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Soft, friendly female' },
    { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Authoritative British male' },
    { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', description: 'Natural, conversational male' },
    { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', description: 'Deep, trustworthy male' },
  ],
  synthszr: [
    { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Authoritative British male' },
    { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', description: 'Deep, trustworthy male' },
    { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', description: 'Natural, conversational male' },
    { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Warm, professional female' },
  ],
}

// ElevenLabs voice presets for Podcast (conversational) - English
const PODCAST_VOICES_EN = [
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Warm, professional female' },
  { id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', description: 'Energetic, youthful female' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Soft, friendly female' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Authoritative British male' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', description: 'Natural, conversational male' },
  { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', description: 'Deep, trustworthy male' },
  { id: '9BWtsMINqrJLrRacOk9x', name: 'Aria', description: 'Expressive, dynamic female' },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', description: 'Confident, clear male' },
]

// ElevenLabs voice presets for Podcast - German
const PODCAST_VOICES_DE = [
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', description: 'Warm, professional female' },
  { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', description: 'Clear, articulate female' },
  { id: 'g5CIjZEefAph4nQFvHAz', name: 'Ethan', description: 'Natural German male' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Authoritative male (EN accent)' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Warm female (EN accent)' },
]

// Example test script for podcast generation
const EXAMPLE_PODCAST_SCRIPT = `HOST: [cheerfully] Good morning and welcome to Synthszr Daily! I'm your host, and today we have some exciting market news to discuss.
GUEST: [thoughtfully] Thanks for having me. And yes... the markets are definitely giving us a lot to talk about today.
HOST: [curiously] Let's dive right in. What caught your attention this morning?
GUEST: [excitedly] Well, the Fed minutes came out and... [seriously] I have to say, the hawkish tone surprised me a bit.
HOST: [thoughtfully] Interesting. How do you think that will impact tech stocks?
GUEST: [skeptically] Look... the market has been pricing in rate cuts for months now. If those get pushed back, we could see some volatility.
HOST: [cheerfully] Great insights as always! That's all the time we have for today.
GUEST: [laughing] Until next time!`

// Example podcast script prompt
const PODCAST_SCRIPT_PROMPT = `Du bist ein erfahrener Podcast-Skriptautor. Erstelle ein lebendiges, natürliches Gespräch zwischen einem Host und einem Gast für einen Finance/Tech-Podcast.

**Rollen:**
- HOST: Moderiert das Gespräch, stellt Fragen, fasst zusammen
- GUEST: Synthszr - der AI-Analyst mit pointierten Meinungen

**Output-Format (WICHTIG - exakt dieses Format pro Zeile):**
HOST: [emotion] Dialog text...
GUEST: [emotion] Dialog text...

**Verfügbare Emotion-Tags:**
- [cheerfully] - fröhlich, begeistert
- [thoughtfully] - nachdenklich, überlegend
- [seriously] - ernst, wichtig
- [excitedly] - aufgeregt, enthusiastisch
- [skeptically] - skeptisch, hinterfragend
- [laughing] - lachend
- [sighing] - seufzend
- [whispering] - flüsternd (für dramatische Effekte)
- [interrupting] - unterbrechend
- [curiously] - neugierig

**Stilregeln für natürliche Dialoge:**
1. Nutze Füllwörter: "Also...", "Hmm...", "Weißt du...", "Naja..."
2. Unterbrechungen: GUEST kann HOST unterbrechen wenn aufgeregt
3. Reaktionen: "Genau!", "Interessant!", "Warte mal..."
4. Pausen mit "..." für Denkpausen
5. Variiere die Satzlänge - kurze Einwürfe, längere Erklärungen
6. Der GUEST bringt die "Synthszr Take" Meinungen aus dem Artikel ein

**Beispiel:**
HOST: [cheerfully] Willkommen bei Synthszr Daily! Heute haben wir wieder einiges zu besprechen...
GUEST: [thoughtfully] Ja, und ich muss sagen... die Zahlen haben mich wirklich überrascht.
HOST: [excitedly] Genau da wollte ich anfangen! Was genau—
GUEST: [interrupting] Also, warte mal. Bevor wir da reingehen... [seriously] die Zahlen sind gut, klar. Aber der Markt preist schon Perfektion ein.
HOST: [curiously] Interessant! Kannst du das genauer erklären?

**Ziel-Länge:** {duration} Minuten (ca. {wordCount} Wörter)

**Blog-Artikel Content für diese Episode:**
{content}

Erstelle jetzt das Podcast-Skript. Beginne direkt mit "HOST:" - keine Einleitung oder Erklärung.`

export default function AudioPage() {
  const [ttsSettings, setTtsSettings] = useState<TTSSettings | null>(null)
  const [ttsLoading, setTtsLoading] = useState(true)
  const [ttsSaving, setTtsSaving] = useState(false)
  const [ttsSuccess, setTtsSuccess] = useState(false)
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null)
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null)
  const [activeTab, setActiveTab] = useState('reading')

  // Podcast-specific state
  const [podcastDuration, setPodcastDuration] = useState(15)
  const [podcastScript, setPodcastScript] = useState(EXAMPLE_PODCAST_SCRIPT)
  const [podcastGenerating, setPodcastGenerating] = useState(false)
  const [podcastAudioUrl, setPodcastAudioUrl] = useState<string | null>(null)
  const [podcastError, setPodcastError] = useState<string | null>(null)
  const [podcastDurationSeconds, setPodcastDurationSeconds] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Post selection for script generation
  const [recentPosts, setRecentPosts] = useState<Array<{ id: string; title: string; slug: string; created_at: string }>>([])
  const [selectedPostId, setSelectedPostId] = useState<string>('')
  const [selectedLocale, setSelectedLocale] = useState<'de' | 'en' | 'cs' | 'nds'>('de')
  const [scriptGenerating, setScriptGenerating] = useState(false)
  const [customPrompt, setCustomPrompt] = useState(PODCAST_SCRIPT_PROMPT)

  useEffect(() => {
    fetchTTSSettings()
    fetchRecentPosts()
  }, [])

  async function fetchRecentPosts() {
    try {
      const res = await fetch('/api/admin/posts?limit=20&published=true')
      if (res.ok) {
        const data = await res.json()
        setRecentPosts(data.posts || [])
      }
    } catch (error) {
      console.error('Error fetching posts:', error)
    }
  }

  async function generateScriptFromPost() {
    if (!selectedPostId) {
      setPodcastError('Bitte wähle einen Post aus')
      return
    }

    setScriptGenerating(true)
    setPodcastError(null)

    try {
      const res = await fetch('/api/podcast/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: selectedPostId,
          locale: selectedLocale,
          durationMinutes: podcastDuration,
          customPrompt: customPrompt,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Script-Generierung fehlgeschlagen')
      }

      setPodcastScript(data.script)
      setPodcastAudioUrl(null) // Reset audio when new script is generated
    } catch (error) {
      console.error('Script generation error:', error)
      setPodcastError(error instanceof Error ? error.message : 'Unbekannter Fehler')
    } finally {
      setScriptGenerating(false)
    }
  }

  async function fetchTTSSettings() {
    try {
      const res = await fetch('/api/admin/tts-settings')
      if (res.ok) {
        const data = await res.json()
        setTtsSettings(data)
        if (data.podcast_duration_minutes) {
          setPodcastDuration(data.podcast_duration_minutes)
        }
        // Load saved prompt or keep default
        if (data.podcast_script_prompt) {
          setCustomPrompt(data.podcast_script_prompt)
        }
      }
    } catch (error) {
      console.error('Error fetching TTS settings:', error)
    } finally {
      setTtsLoading(false)
    }
  }

  async function saveTTSSettings() {
    if (!ttsSettings) return
    setTtsSaving(true)
    setTtsSuccess(false)
    try {
      const res = await fetch('/api/admin/tts-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ttsSettings,
          podcast_duration_minutes: podcastDuration,
          podcast_script_prompt: customPrompt !== PODCAST_SCRIPT_PROMPT ? customPrompt : null,
        }),
      })
      if (res.ok) {
        setTtsSuccess(true)
        setTimeout(() => setTtsSuccess(false), 3000)
      }
    } catch (error) {
      console.error('Error saving TTS settings:', error)
    } finally {
      setTtsSaving(false)
    }
  }

  async function previewVoice(voice: TTSVoice, locale: 'de' | 'en') {
    if (previewAudio) {
      previewAudio.pause()
      previewAudio.src = ''
    }

    const voiceKey = `${voice}-${locale}`
    setPreviewingVoice(voiceKey)

    try {
      const sampleText = locale === 'de'
        ? 'Dies ist eine Vorschau der ausgewählten Stimme für den deutschen Newsletter.'
        : 'This is a preview of the selected voice for the English newsletter.'

      const res = await fetch('/api/admin/tts-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sampleText, voice, model: ttsSettings?.tts_model || 'tts-1' }),
      })

      if (res.ok) {
        const data = await res.json()
        if (data.audioBase64) {
          const audio = new Audio(`data:audio/mpeg;base64,${data.audioBase64}`)
          setPreviewAudio(audio)
          audio.onended = () => setPreviewingVoice(null)
          audio.play()
        }
      }
    } catch (error) {
      console.error('Error previewing voice:', error)
    } finally {
      if (previewingVoice === voiceKey) {
        setTimeout(() => setPreviewingVoice(null), 100)
      }
    }
  }

  // Calculate estimated word count based on duration
  const estimatedWordCount = Math.round(podcastDuration * 150) // ~150 words per minute for natural speech

  // Podcast generation
  async function generatePodcast() {
    if (!podcastScript.trim()) {
      setPodcastError('Bitte gib ein Script ein')
      return
    }

    setPodcastGenerating(true)
    setPodcastError(null)
    setPodcastAudioUrl(null)

    try {
      const res = await fetch('/api/podcast/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: podcastScript,
          hostVoiceId: ttsSettings?.podcast_host_voice_id,
          guestVoiceId: ttsSettings?.podcast_guest_voice_id,
          title: `test-podcast-${Date.now()}`,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Podcast-Generierung fehlgeschlagen')
      }

      setPodcastAudioUrl(data.audioUrl)
      setPodcastDurationSeconds(data.durationSeconds)
    } catch (error) {
      console.error('Podcast generation error:', error)
      setPodcastError(error instanceof Error ? error.message : 'Unbekannter Fehler')
    } finally {
      setPodcastGenerating(false)
    }
  }

  // Audio playback
  function togglePlayback() {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }

  // Count lines in script
  const scriptLineCount = podcastScript.split('\n').filter(line =>
    line.trim().match(/^(HOST|GUEST):/i)
  ).length

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tighter flex items-center gap-3">
          <Volume2 className="h-8 w-8" />
          Audio
        </h1>
        <p className="mt-1 text-muted-foreground">
          Sprachausgabe und Podcast-Einstellungen für Blog-Artikel
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="reading" className="flex items-center gap-2">
            <Volume2 className="h-4 w-4" />
            Reading
          </TabsTrigger>
          <TabsTrigger value="podcast" className="flex items-center gap-2">
            <Mic className="h-4 w-4" />
            Podcast
          </TabsTrigger>
        </TabsList>

        {/* Reading Tab - TTS Settings */}
        <TabsContent value="reading" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Volume2 className="h-5 w-5" />
                Sprachausgabe (TTS)
              </CardTitle>
              <CardDescription>
                Text-to-Speech Einstellungen für Blog-Artikel mit dualer Stimme
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {ttsLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Lade TTS-Einstellungen...</span>
                </div>
              ) : ttsSettings ? (
                <>
                  {/* TTS Enabled */}
                  <div className="flex items-center justify-between pb-4 border-b">
                    <div>
                      <Label className="text-base">TTS aktivieren</Label>
                      <p className="text-sm text-muted-foreground">
                        Audio-Version für Blogposts generieren
                      </p>
                    </div>
                    <Switch
                      checked={ttsSettings.tts_enabled}
                      onCheckedChange={(enabled) =>
                        setTtsSettings({ ...ttsSettings, tts_enabled: enabled })
                      }
                    />
                  </div>

                  {ttsSettings.tts_enabled && (
                    <>
                      {/* TTS Provider Selection */}
                      <div className="space-y-3 pb-4 border-b">
                        <div>
                          <Label className="text-base">TTS-Anbieter</Label>
                          <p className="text-sm text-muted-foreground">
                            OpenAI ist günstiger, ElevenLabs hat höhere Qualität
                          </p>
                        </div>
                        <Select
                          value={ttsSettings.tts_provider || 'openai'}
                          onValueChange={(value: TTSProvider) =>
                            setTtsSettings({ ...ttsSettings, tts_provider: value })
                          }
                        >
                          <SelectTrigger className="w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="openai">OpenAI TTS</SelectItem>
                            <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* OpenAI Settings */}
                      {(ttsSettings.tts_provider === 'openai' || !ttsSettings.tts_provider) && (
                        <>
                          {/* TTS Model */}
                          <div className="space-y-3 pb-4 border-b">
                            <div>
                              <Label className="text-base">OpenAI TTS-Modell</Label>
                              <p className="text-sm text-muted-foreground">
                                tts-1 ist schneller, tts-1-hd hat höhere Qualität
                              </p>
                            </div>
                            <Select
                              value={ttsSettings.tts_model}
                              onValueChange={(value: TTSModel) =>
                                setTtsSettings({ ...ttsSettings, tts_model: value })
                              }
                            >
                              <SelectTrigger className="w-48">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="tts-1">tts-1 (Standard)</SelectItem>
                                <SelectItem value="tts-1-hd">tts-1-hd (HD)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* OpenAI English Voices */}
                          <div className="space-y-4 pb-4 border-b">
                            <div>
                              <Label className="text-base">OpenAI Stimmen (Englisch)</Label>
                              <p className="text-sm text-muted-foreground">
                                Stimmen für alle Sprachversionen (EN TTS Qualität ist besser)
                              </p>
                            </div>

                            {/* News Voice EN */}
                            <div className="flex items-center gap-4">
                              <div className="flex-1">
                                <Label className="text-sm">Nachrichten</Label>
                                <Select
                                  value={ttsSettings.tts_news_voice_en}
                                  onValueChange={(value: TTSVoice) =>
                                    setTtsSettings({ ...ttsSettings, tts_news_voice_en: value })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="nova">Nova (empfohlen)</SelectItem>
                                    <SelectItem value="shimmer">Shimmer</SelectItem>
                                    <SelectItem value="alloy">Alloy</SelectItem>
                                    <SelectItem value="echo">Echo</SelectItem>
                                    <SelectItem value="fable">Fable</SelectItem>
                                    <SelectItem value="onyx">Onyx</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => previewVoice(ttsSettings.tts_news_voice_en, 'en')}
                                disabled={previewingVoice === `${ttsSettings.tts_news_voice_en}-en`}
                              >
                                {previewingVoice === `${ttsSettings.tts_news_voice_en}-en` ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                              </Button>
                            </div>

                            {/* Synthszr Voice EN */}
                            <div className="flex items-center gap-4">
                              <div className="flex-1">
                                <Label className="text-sm">Synthszr Take</Label>
                                <Select
                                  value={ttsSettings.tts_synthszr_voice_en}
                                  onValueChange={(value: TTSVoice) =>
                                    setTtsSettings({ ...ttsSettings, tts_synthszr_voice_en: value })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="onyx">Onyx (empfohlen)</SelectItem>
                                    <SelectItem value="echo">Echo</SelectItem>
                                    <SelectItem value="fable">Fable</SelectItem>
                                    <SelectItem value="alloy">Alloy</SelectItem>
                                    <SelectItem value="nova">Nova</SelectItem>
                                    <SelectItem value="shimmer">Shimmer</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => previewVoice(ttsSettings.tts_synthszr_voice_en, 'en')}
                                disabled={previewingVoice === `${ttsSettings.tts_synthszr_voice_en}-en`}
                              >
                                {previewingVoice === `${ttsSettings.tts_synthszr_voice_en}-en` ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </div>
                        </>
                      )}

                      {/* ElevenLabs Settings */}
                      {ttsSettings.tts_provider === 'elevenlabs' && (
                        <>
                          {/* ElevenLabs Model */}
                          <div className="space-y-3 pb-4 border-b">
                            <div>
                              <Label className="text-base">ElevenLabs Modell</Label>
                              <p className="text-sm text-muted-foreground">
                                Multilingual v2 für beste Qualität, Turbo für schnellere Generierung
                              </p>
                            </div>
                            <Select
                              value={ttsSettings.elevenlabs_model || 'eleven_multilingual_v2'}
                              onValueChange={(value: ElevenLabsModel) =>
                                setTtsSettings({ ...ttsSettings, elevenlabs_model: value })
                              }
                            >
                              <SelectTrigger className="w-64">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="eleven_multilingual_v2">Multilingual v2 (empfohlen)</SelectItem>
                                <SelectItem value="eleven_turbo_v2_5">Turbo v2.5 (schnell)</SelectItem>
                                <SelectItem value="eleven_turbo_v2">Turbo v2</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* ElevenLabs Voices */}
                          <div className="space-y-4 pb-4 border-b">
                            <div>
                              <Label className="text-base">ElevenLabs Stimmen</Label>
                              <p className="text-sm text-muted-foreground">
                                Hochwertige Stimmen für alle Sprachversionen
                              </p>
                            </div>

                            {/* News Voice */}
                            <div className="flex items-center gap-4">
                              <div className="flex-1">
                                <Label className="text-sm">Nachrichten</Label>
                                <Select
                                  value={ttsSettings.elevenlabs_news_voice_en || 'pFZP5JQG7iQjIQuC4Bku'}
                                  onValueChange={(value: string) =>
                                    setTtsSettings({ ...ttsSettings, elevenlabs_news_voice_en: value })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ELEVENLABS_VOICES.news.map((voice) => (
                                      <SelectItem key={voice.id} value={voice.id}>
                                        {voice.name} - {voice.description}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            {/* Synthszr Voice */}
                            <div className="flex items-center gap-4">
                              <div className="flex-1">
                                <Label className="text-sm">Synthszr Take</Label>
                                <Select
                                  value={ttsSettings.elevenlabs_synthszr_voice_en || 'onwK4e9ZLuTAKqWW03F9'}
                                  onValueChange={(value: string) =>
                                    setTtsSettings({ ...ttsSettings, elevenlabs_synthszr_voice_en: value })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ELEVENLABS_VOICES.synthszr.map((voice) => (
                                      <SelectItem key={voice.id} value={voice.id}>
                                        {voice.name} - {voice.description}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>

                          <Alert>
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>
                              ElevenLabs erfordert einen API-Key (ELEVENLABS_API_KEY in .env.local)
                            </AlertDescription>
                          </Alert>
                        </>
                      )}
                    </>
                  )}

                  {/* Save Button */}
                  <div className="flex items-center gap-4">
                    <Button onClick={saveTTSSettings} disabled={ttsSaving}>
                      {ttsSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Einstellungen speichern
                    </Button>
                    {ttsSuccess && (
                      <span className="text-sm text-green-600 flex items-center gap-1">
                        <CheckCircle className="h-4 w-4" />
                        Gespeichert
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {ttsSettings.tts_provider === 'elevenlabs'
                      ? 'Audio wird mit ElevenLabs generiert. Höhere Qualität, aber teurer (~$0.50+ pro Artikel).'
                      : 'Audio wird mit OpenAI TTS generiert. Geschätzte Kosten: ~$0.30 pro Artikel.'
                    }
                    {' '}Nachrichten-Content wird mit der ersten Stimme, Synthszr Take Abschnitte mit der zweiten Stimme vorgelesen.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  TTS-Einstellungen konnten nicht geladen werden.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Podcast Tab */}
        <TabsContent value="podcast" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="h-5 w-5" />
                Podcast-Einstellungen
              </CardTitle>
              <CardDescription>
                Konfiguriere die ElevenLabs Text-to-Dialogue API für natürliche Podcast-Gespräche
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {ttsLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Lade Einstellungen...</span>
                </div>
              ) : ttsSettings ? (
                <>
                  {/* Language Mapping Info */}
                  <Alert className="bg-muted/50">
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      <strong>TTS-Sprache pro Locale:</strong>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {PODCAST_LOCALES.map((loc) => (
                          <Badge key={loc.code} variant={loc.ttsLang === 'de' ? 'default' : 'secondary'}>
                            {loc.name} → {loc.ttsLang === 'de' ? 'Deutsch' : 'English'} TTS
                          </Badge>
                        ))}
                      </div>
                    </AlertDescription>
                  </Alert>

                  {/* German Voices Section */}
                  <div className="space-y-4 pb-4 border-b">
                    <div className="flex items-center gap-2">
                      <Badge variant="default">DE</Badge>
                      <Label className="text-base">Deutsche Stimmen</Label>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Verwendet für: Deutsch (de)
                    </p>

                    <div className="grid gap-4 sm:grid-cols-2">
                      {/* Host Voice DE */}
                      <div className="space-y-2">
                        <Label className="text-sm">Host (News)</Label>
                        <Select
                          value={ttsSettings.podcast_host_voice_de || ttsSettings.podcast_host_voice_id || 'XrExE9yKIg1WjnnlVkGX'}
                          onValueChange={(value: string) =>
                            setTtsSettings({ ...ttsSettings, podcast_host_voice_de: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PODCAST_VOICES_DE.map((voice) => (
                              <SelectItem key={voice.id} value={voice.id}>
                                {voice.name} - {voice.description}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Guest Voice DE */}
                      <div className="space-y-2">
                        <Label className="text-sm">Guest (Synthszr)</Label>
                        <Select
                          value={ttsSettings.podcast_guest_voice_de || ttsSettings.podcast_guest_voice_id || 'g5CIjZEefAph4nQFvHAz'}
                          onValueChange={(value: string) =>
                            setTtsSettings({ ...ttsSettings, podcast_guest_voice_de: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PODCAST_VOICES_DE.map((voice) => (
                              <SelectItem key={voice.id} value={voice.id}>
                                {voice.name} - {voice.description}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {/* English Voices Section */}
                  <div className="space-y-4 pb-4 border-b">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">EN</Badge>
                      <Label className="text-base">Englische Stimmen</Label>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Verwendet für: English (en), Čeština (cs), Plattdüütsch (nds)
                    </p>

                    <div className="grid gap-4 sm:grid-cols-2">
                      {/* Host Voice EN */}
                      <div className="space-y-2">
                        <Label className="text-sm">Host (News)</Label>
                        <Select
                          value={ttsSettings.podcast_host_voice_en || 'pFZP5JQG7iQjIQuC4Bku'}
                          onValueChange={(value: string) =>
                            setTtsSettings({ ...ttsSettings, podcast_host_voice_en: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PODCAST_VOICES_EN.map((voice) => (
                              <SelectItem key={voice.id} value={voice.id}>
                                {voice.name} - {voice.description}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Guest Voice EN */}
                      <div className="space-y-2">
                        <Label className="text-sm">Guest (Synthszr)</Label>
                        <Select
                          value={ttsSettings.podcast_guest_voice_en || 'onwK4e9ZLuTAKqWW03F9'}
                          onValueChange={(value: string) =>
                            setTtsSettings({ ...ttsSettings, podcast_guest_voice_en: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PODCAST_VOICES_EN.map((voice) => (
                              <SelectItem key={voice.id} value={voice.id}>
                                {voice.name} - {voice.description}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {/* Duration Slider */}
                  <div className="space-y-4 pb-4 border-b">
                    <div>
                      <Label className="text-base">Podcast-Länge</Label>
                      <p className="text-sm text-muted-foreground">
                        Ziel-Dauer des generierten Podcasts
                      </p>
                    </div>
                    <div className="space-y-3">
                      <Slider
                        value={[podcastDuration]}
                        onValueChange={(value) => setPodcastDuration(value[0])}
                        min={5}
                        max={30}
                        step={1}
                        className="w-full max-w-md"
                      />
                      <div className="flex items-center justify-between max-w-md">
                        <span className="text-sm text-muted-foreground">5 Min</span>
                        <Badge variant="secondary" className="text-sm">
                          {podcastDuration} Minuten
                        </Badge>
                        <span className="text-sm text-muted-foreground">30 Min</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Geschätzte Wortanzahl: ~{estimatedWordCount.toLocaleString()} Wörter
                      </p>
                    </div>
                  </div>

                  {/* Save Button */}
                  <div className="flex items-center gap-4">
                    <Button onClick={saveTTSSettings} disabled={ttsSaving}>
                      {ttsSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Einstellungen speichern
                    </Button>
                    {ttsSuccess && (
                      <span className="text-sm text-green-600 flex items-center gap-1">
                        <CheckCircle className="h-4 w-4" />
                        Gespeichert
                      </span>
                    )}
                  </div>

                  <Alert className="bg-blue-500/5 border-blue-500/20">
                    <Info className="h-4 w-4 text-blue-500" />
                    <AlertDescription className="text-sm">
                      Der Podcast verwendet die ElevenLabs <strong>Text-to-Dialogue API</strong> für natürliche
                      Gespräche mit automatischen Übergängen, Pausen und Unterbrechungen.
                    </AlertDescription>
                  </Alert>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Einstellungen konnten nicht geladen werden.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Podcast Test & Preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Podcast testen
              </CardTitle>
              <CardDescription>
                Generiere ein Podcast-Script aus einem Blog-Post oder teste mit einem eigenen Script
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Post Selection for Script Generation */}
              <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
                <Label className="text-sm font-medium">Script aus Post generieren</Label>
                <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
                  <Select
                    value={selectedPostId}
                    onValueChange={setSelectedPostId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Post auswählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      {recentPosts.map((post) => (
                        <SelectItem key={post.id} value={post.id}>
                          <span className="truncate max-w-[300px] block">
                            {post.title}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={selectedLocale}
                    onValueChange={(v) => setSelectedLocale(v as 'de' | 'en' | 'cs' | 'nds')}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PODCAST_LOCALES.map((loc) => (
                        <SelectItem key={loc.code} value={loc.code}>
                          {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    onClick={generateScriptFromPost}
                    disabled={scriptGenerating || !selectedPostId}
                    variant="secondary"
                  >
                    {scriptGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generiere...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Script generieren
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Claude generiert ein Podcast-Script basierend auf dem Post-Content (~{podcastDuration} Min)
                </p>
              </div>

              {/* Script Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Script</Label>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileText className="h-3 w-3" />
                    {scriptLineCount} Zeilen
                  </div>
                </div>
                <Textarea
                  value={podcastScript}
                  onChange={(e) => setPodcastScript(e.target.value)}
                  placeholder="HOST: [cheerfully] Welcome to the show!&#10;GUEST: [thoughtfully] Thanks for having me..."
                  className="font-mono text-sm h-[300px]"
                />
                <p className="text-xs text-muted-foreground">
                  Format: <code className="bg-muted px-1 rounded">HOST:</code> oder <code className="bg-muted px-1 rounded">GUEST:</code> gefolgt von optionalen Emotion-Tags wie <code className="bg-muted px-1 rounded">[cheerfully]</code>
                </p>
              </div>

              {/* Generate Button & Status */}
              <div className="flex items-center gap-4">
                <Button
                  onClick={generatePodcast}
                  disabled={podcastGenerating || !podcastScript.trim()}
                  className="min-w-[180px]"
                >
                  {podcastGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generiere...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Podcast generieren
                    </>
                  )}
                </Button>

                {podcastGenerating && (
                  <span className="text-sm text-muted-foreground">
                    Dies kann je nach Script-Länge 30-120 Sekunden dauern...
                  </span>
                )}
              </div>

              {/* Error */}
              {podcastError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{podcastError}</AlertDescription>
                </Alert>
              )}

              {/* Audio Player */}
              {podcastAudioUrl && (
                <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={togglePlayback}
                        className="h-10 w-10"
                      >
                        {isPlaying ? (
                          <Pause className="h-5 w-5" />
                        ) : (
                          <Play className="h-5 w-5" />
                        )}
                      </Button>
                      <div>
                        <p className="text-sm font-medium">Podcast Preview</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {podcastDurationSeconds ? `~${Math.floor(podcastDurationSeconds / 60)}:${String(podcastDurationSeconds % 60).padStart(2, '0')}` : 'Unbekannt'}
                        </p>
                      </div>
                    </div>
                    <a
                      href={podcastAudioUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline"
                    >
                      MP3 herunterladen
                    </a>
                  </div>
                  <audio
                    ref={audioRef}
                    src={podcastAudioUrl}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    controls
                    className="w-full h-10"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Script Prompt Editor */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Info className="h-5 w-5" />
                Skript-Prompt Vorlage
              </CardTitle>
              <CardDescription>
                Bearbeite den Prompt um die Podcast-Generierung anzupassen. Platzhalter: {'{duration}'}, {'{wordCount}'}, {'{content}'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="font-mono text-xs h-[400px]"
              />
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Verfügbare Emotion-Tags:</p>
                    <div className="flex flex-wrap gap-2">
                      {['[cheerfully]', '[thoughtfully]', '[seriously]', '[excitedly]', '[skeptically]', '[laughing]', '[sighing]', '[whispering]', '[interrupting]'].map((tag) => (
                        <Badge key={tag} variant="outline" className="font-mono text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCustomPrompt(PODCAST_SCRIPT_PROMPT)}
                      disabled={customPrompt === PODCAST_SCRIPT_PROMPT}
                    >
                      Zurücksetzen
                    </Button>
                    <Button
                      size="sm"
                      onClick={saveTTSSettings}
                      disabled={ttsSaving}
                    >
                      {ttsSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Prompt speichern
                    </Button>
                  </div>
                </div>
                {ttsSuccess && (
                  <span className="text-sm text-green-600 flex items-center gap-1">
                    <CheckCircle className="h-4 w-4" />
                    Gespeichert
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
