'use client'

import { useEffect, useState } from 'react'
import { Volume2, Mic, CheckCircle, Loader2, Save, Play, AlertTriangle, Info } from 'lucide-react'
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
  // Podcast settings
  podcast_host_voice_id: string
  podcast_guest_voice_id: string
  podcast_duration_minutes: number
}

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

// ElevenLabs voice presets for Podcast (conversational)
const PODCAST_VOICES = [
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Warm host voice, professional' },
  { id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', description: 'Energetic, youthful' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Soft, friendly' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Authoritative British' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', description: 'Natural, conversational' },
  { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', description: 'Deep, trustworthy' },
  { id: '9BWtsMINqrJLrRacOk9x', name: 'Aria', description: 'Expressive, dynamic' },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', description: 'Confident, clear' },
]

// Example podcast script prompt
const PODCAST_SCRIPT_PROMPT = `Du bist ein erfahrener Podcast-Skriptautor. Erstelle ein lebendiges, natürliches Gespräch zwischen einem Host und einem Gast für einen Finance/Tech-Podcast.

**Rollen:**
- HOST: Moderiert das Gespräch, stellt Fragen, fasst zusammen
- GUEST: Synthszr - der AI-Analyst mit pointierten Meinungen

**Format für jede Zeile:**
{"speaker": "HOST" | "GUEST", "text": "[emotion] Dialog..."}

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

**Stilregeln für natürliche Dialoge:**
1. Nutze Füllwörter: "Also...", "Hmm...", "Weißt du...", "Naja..."
2. Unterbrechungen: GUEST kann HOST unterbrechen wenn aufgeregt
3. Reaktionen: "Genau!", "Interessant!", "Warte mal..."
4. Pausen mit "..." für Denkpausen
5. Variiere die Satzlänge - kurze Einwürfe, längere Erklärungen

**Beispiel-Struktur:**
{"speaker": "HOST", "text": "[cheerfully] Willkommen bei Synthszr Daily! Heute haben wir wieder einiges zu besprechen..."}
{"speaker": "GUEST", "text": "[thoughtfully] Ja, und ich muss sagen... die Nvidia-Zahlen haben mich wirklich überrascht."}
{"speaker": "HOST", "text": "[excitedly] Genau da wollte ich anfangen! Was genau—"}
{"speaker": "GUEST", "text": "[interrupting] Also, warte mal. Bevor wir da reingehen... [seriously] die Zahlen sind gut, klar. Aber der Markt preist schon Perfektion ein."}

**Ziel-Länge:** {duration} Minuten (ca. {wordCount} Wörter)

**Content für diese Episode:**
{content}

Erstelle jetzt das Skript als JSON-Array mit natürlichen Übergängen, Emotionen und gelegentlichen Unterbrechungen.`

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

  useEffect(() => {
    fetchTTSSettings()
  }, [])

  async function fetchTTSSettings() {
    try {
      const res = await fetch('/api/admin/tts-settings')
      if (res.ok) {
        const data = await res.json()
        setTtsSettings(data)
        if (data.podcast_duration_minutes) {
          setPodcastDuration(data.podcast_duration_minutes)
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
                  {/* Host Voice */}
                  <div className="space-y-3 pb-4 border-b">
                    <div>
                      <Label className="text-base">Host-Stimme (Nachrichten)</Label>
                      <p className="text-sm text-muted-foreground">
                        Moderiert das Gespräch und präsentiert die News
                      </p>
                    </div>
                    <Select
                      value={ttsSettings.podcast_host_voice_id || 'pFZP5JQG7iQjIQuC4Bku'}
                      onValueChange={(value: string) =>
                        setTtsSettings({ ...ttsSettings, podcast_host_voice_id: value })
                      }
                    >
                      <SelectTrigger className="w-full max-w-md">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PODCAST_VOICES.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{voice.name}</span>
                              <span className="text-muted-foreground">- {voice.description}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Guest Voice */}
                  <div className="space-y-3 pb-4 border-b">
                    <div>
                      <Label className="text-base">Guest-Stimme (Synthszr Takes)</Label>
                      <p className="text-sm text-muted-foreground">
                        Der AI-Analyst mit pointierten Meinungen und Analysen
                      </p>
                    </div>
                    <Select
                      value={ttsSettings.podcast_guest_voice_id || 'onwK4e9ZLuTAKqWW03F9'}
                      onValueChange={(value: string) =>
                        setTtsSettings({ ...ttsSettings, podcast_guest_voice_id: value })
                      }
                    >
                      <SelectTrigger className="w-full max-w-md">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PODCAST_VOICES.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{voice.name}</span>
                              <span className="text-muted-foreground">- {voice.description}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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

          {/* Script Prompt Reference */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Info className="h-5 w-5" />
                Skript-Prompt Vorlage
              </CardTitle>
              <CardDescription>
                Dieser Prompt wird verwendet um lebendige Podcast-Skripte zu generieren
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={PODCAST_SCRIPT_PROMPT
                  .replace('{duration}', String(podcastDuration))
                  .replace('{wordCount}', String(estimatedWordCount))
                  .replace('{content}', '[Blog-Artikel Content wird hier eingefügt]')
                }
                readOnly
                className="font-mono text-xs h-[400px] bg-muted/50"
              />
              <div className="mt-4 space-y-2">
                <p className="text-sm font-medium">Verfügbare Emotion-Tags:</p>
                <div className="flex flex-wrap gap-2">
                  {['[cheerfully]', '[thoughtfully]', '[seriously]', '[excitedly]', '[skeptically]', '[laughing]', '[sighing]', '[whispering]', '[interrupting]'].map((tag) => (
                    <Badge key={tag} variant="outline" className="font-mono text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
