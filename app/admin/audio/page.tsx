'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Volume2, Mic, CheckCircle, Loader2, Save, Play, AlertTriangle, Info, Pause, Sparkles, Clock, FileText, Headphones, Users } from 'lucide-react'
import { StereoPodcastPlayer } from '@/components/stereo-podcast-player'
import type { SegmentMetadata } from '@/lib/audio/stereo-mixer'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TTSVoice = 'alloy' | 'echo' | 'fable' | 'nova' | 'onyx' | 'shimmer'
type TTSModel = 'tts-1' | 'tts-1-hd'
type TTSProvider = 'openai' | 'elevenlabs'
type ElevenLabsModel = 'eleven_multilingual_v2' | 'eleven_turbo_v2_5' | 'eleven_turbo_v2'
type PodcastProvider = 'openai' | 'elevenlabs'

interface TTSSettings {
  tts_provider: TTSProvider
  tts_news_voice_de: TTSVoice
  tts_news_voice_en: TTSVoice
  tts_synthszr_voice_de: TTSVoice
  tts_synthszr_voice_en: TTSVoice
  tts_model: TTSModel
  tts_enabled: boolean
  elevenlabs_news_voice_en: string
  elevenlabs_synthszr_voice_en: string
  elevenlabs_model: ElevenLabsModel
  podcast_host_voice_id: string
  podcast_guest_voice_id: string
  podcast_host_voice_de: string
  podcast_guest_voice_de: string
  podcast_host_voice_en: string
  podcast_guest_voice_en: string
  podcast_duration_minutes: number
  podcast_script_prompt: string | null
}

interface PersonalityState {
  id: string
  locale: string
  episode_count: number
  relationship_phase: string
  host_warmth: number
  host_humor: number
  host_formality: number
  host_curiosity: number
  host_self_awareness: number
  guest_confidence: number
  guest_playfulness: number
  guest_directness: number
  guest_empathy: number
  guest_self_awareness: number
  mutual_comfort: number
  flirtation_tendency: number
  inside_joke_count: number
  memorable_moments: Array<{ episode: number; text: string }>
  last_episode_at: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type PodcastLocale = 'de' | 'en' | 'cs' | 'nds'
const PODCAST_LOCALES: { code: PodcastLocale; name: string; ttsLang: 'de' | 'en' }[] = [
  { code: 'de', name: 'Deutsch', ttsLang: 'de' },
  { code: 'en', name: 'English', ttsLang: 'en' },
  { code: 'cs', name: 'Čeština', ttsLang: 'en' },
  { code: 'nds', name: 'Plattdüütsch', ttsLang: 'en' },
]

const PODCAST_VOICES_EN = [
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Warm, professional female' },
  { id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', description: 'Energetic, youthful female' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Soft, friendly female' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Authoritative British male' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', description: 'Natural, conversational male' },
  { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', description: 'Deep, trustworthy male' },
  { id: '9BWtsMINqrJLrRacOk9x', name: 'Aria', description: 'Expressive, dynamic female' },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', description: 'Confident, clear male' },
  { id: 'aMSt68OGf4xUZAnLpTU8', name: 'Custom 1', description: 'Custom voice' },
  { id: 'j46AY0iVY3oHcnZbgEJg', name: 'Custom 2', description: 'Custom voice' },
]

const PODCAST_VOICES_DE = [
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', description: 'Warm, professional female' },
  { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', description: 'Clear, articulate female' },
  { id: 'g5CIjZEefAph4nQFvHAz', name: 'Ethan', description: 'Natural German male' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Authoritative male (EN accent)' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Warm female (EN accent)' },
  { id: 'aMSt68OGf4xUZAnLpTU8', name: 'Custom 1', description: 'Custom voice' },
  { id: 'j46AY0iVY3oHcnZbgEJg', name: 'Custom 2', description: 'Custom voice' },
]

const OPENAI_PODCAST_VOICES: Array<{ id: TTSVoice; name: string; description: string }> = [
  { id: 'nova', name: 'Nova', description: 'Warm, engaging female' },
  { id: 'shimmer', name: 'Shimmer', description: 'Expressive female' },
  { id: 'alloy', name: 'Alloy', description: 'Balanced, neutral' },
  { id: 'echo', name: 'Echo', description: 'Warm male' },
  { id: 'fable', name: 'Fable', description: 'British accent' },
  { id: 'onyx', name: 'Onyx', description: 'Deep, authoritative male' },
]

const EXAMPLE_PODCAST_SCRIPT = `HOST: [cheerfully] Good morning and welcome to Synthszr Daily! I'm your host, and today we have some exciting market news to discuss.
GUEST: [thoughtfully] Thanks for having me. And yes... the markets are definitely giving us a lot to talk about today.
HOST: [curiously] Let's dive right in. What caught your attention this morning?
GUEST: [excitedly] Well, the Fed minutes came out and... [seriously] I have to say, the hawkish tone surprised me a bit.
HOST: [thoughtfully] Interesting. How do you think that will impact tech stocks?
GUEST: [skeptically] Look... the market has been pricing in rate cuts for months now. If those get pushed back, we could see some volatility.
HOST: [cheerfully] Great insights as always! That's all the time we have for today.
GUEST: [laughing] Until next time!`

const PODCAST_SCRIPT_PROMPT = `Du bist ein erfahrener Podcast-Skriptautor. Erstelle ein lebendiges, natürliches Gespräch zwischen einem Host und einem Gast für einen Finance/Tech-Podcast.

**Rollen:**
- HOST: Moderiert das Gespräch, stellt Fragen, fasst zusammen
- GUEST: Synthesizer - der AI-Analyst mit pointierten Meinungen

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
6. Der GUEST bringt die "Synthesizer Take" Meinungen aus dem Artikel ein
7. WICHTIG: Der GUEST wird im Dialog IMMER als "Synthesizer" bezeichnet, NIE als "Synthszr"

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

// ---------------------------------------------------------------------------
// Personality Map Helpers
// ---------------------------------------------------------------------------

const DEFAULT_PERSONALITY: Partial<PersonalityState> = {
  host_warmth: 0.5, host_humor: 0.4, host_formality: 0.6, host_curiosity: 0.7, host_self_awareness: 0.2,
  guest_confidence: 0.6, guest_playfulness: 0.3, guest_directness: 0.7, guest_empathy: 0.4, guest_self_awareness: 0.2,
  mutual_comfort: 0.2, flirtation_tendency: 0.0,
}

function calcPosition(state: Partial<PersonalityState>, role: 'host' | 'guest'): { x: number; y: number } {
  if (role === 'host') {
    const x = ((state.host_warmth ?? 0.5) + (state.host_curiosity ?? 0.7) + (1 - (state.host_formality ?? 0.6))) / 3
    const y = ((state.host_humor ?? 0.4) + (state.host_self_awareness ?? 0.2) + (1 - (state.host_formality ?? 0.6))) / 3
    return { x, y }
  }
  const x = ((state.guest_empathy ?? 0.4) + (state.guest_playfulness ?? 0.3) + (1 - (state.guest_directness ?? 0.7))) / 3
  const y = ((state.guest_confidence ?? 0.6) + (state.guest_playfulness ?? 0.3) + (state.guest_self_awareness ?? 0.2)) / 3
  return { x, y }
}

const PHASE_LABELS: Record<string, string> = {
  strangers: 'Fremde',
  acquaintances: 'Bekannte',
  colleagues: 'Kollegen',
  friends: 'Freunde',
  close_friends: 'Enge Freunde',
}

// ---------------------------------------------------------------------------
// PersonalityMap Component
// ---------------------------------------------------------------------------

function PersonalityMap({ personality }: { personality: PersonalityState | null }) {
  const W = 420
  const H = 420
  const PAD = 60
  const innerW = W - PAD * 2
  const innerH = H - PAD * 2

  const state = personality || DEFAULT_PERSONALITY as PersonalityState

  const hostPos = calcPosition(state, 'host')
  const guestPos = calcPosition(state, 'guest')
  const ghostHost = calcPosition(DEFAULT_PERSONALITY, 'host')
  const ghostGuest = calcPosition(DEFAULT_PERSONALITY, 'guest')

  // Map 0..1 to SVG coordinates
  const toSvgX = (v: number) => PAD + v * innerW
  const toSvgY = (v: number) => PAD + (1 - v) * innerH // Invert Y

  const hx = toSvgX(hostPos.x)
  const hy = toSvgY(hostPos.y)
  const gx = toSvgX(guestPos.x)
  const gy = toSvgY(guestPos.y)
  const ghx = toSvgX(ghostHost.x)
  const ghy = toSvgY(ghostHost.y)
  const ggx = toSvgX(ghostGuest.x)
  const ggy = toSvgY(ghostGuest.y)

  const phase = state.relationship_phase || 'strangers'
  const isClose = phase === 'friends' || phase === 'close_friends'

  // Midpoint for phase label
  const mx = (hx + gx) / 2
  const my = (hy + gy) / 2

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md mx-auto" style={{ fontFamily: 'var(--font-mono, monospace)' }}>
      {/* Background */}
      <rect x={PAD} y={PAD} width={innerW} height={innerH} fill="hsl(var(--muted))" rx={8} opacity={0.3} />

      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map((v) => (
        <g key={v}>
          <line x1={toSvgX(v)} y1={PAD} x2={toSvgX(v)} y2={H - PAD} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="4 4" />
          <line x1={PAD} y1={toSvgY(v)} x2={W - PAD} y2={toSvgY(v)} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="4 4" />
        </g>
      ))}

      {/* Center axes */}
      <line x1={toSvgX(0.5)} y1={PAD} x2={toSvgX(0.5)} y2={H - PAD} stroke="hsl(var(--foreground))" strokeWidth={1} opacity={0.15} />
      <line x1={PAD} y1={toSvgY(0.5)} x2={W - PAD} y2={toSvgY(0.5)} stroke="hsl(var(--foreground))" strokeWidth={1} opacity={0.15} />

      {/* Axis labels */}
      <text x={PAD - 8} y={H / 2} textAnchor="end" fontSize={10} fill="hsl(var(--muted-foreground))" dominantBaseline="middle" style={{ letterSpacing: '0.05em' }}>
        Rational
      </text>
      <text x={W - PAD + 8} y={H / 2} textAnchor="start" fontSize={10} fill="hsl(var(--muted-foreground))" dominantBaseline="middle" style={{ letterSpacing: '0.05em' }}>
        Emotional
      </text>
      <text x={W / 2} y={PAD - 12} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))" style={{ letterSpacing: '0.05em' }}>
        Expressiv
      </text>
      <text x={W / 2} y={H - PAD + 18} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))" style={{ letterSpacing: '0.05em' }}>
        Reserviert
      </text>

      {/* Ghost trails (start → current) */}
      {personality && (
        <>
          <line x1={ghx} y1={ghy} x2={hx} y2={hy} stroke="#f59e0b" strokeWidth={1} opacity={0.2} strokeDasharray="3 3" />
          <line x1={ggx} y1={ggy} x2={gx} y2={gy} stroke="#06b6d4" strokeWidth={1} opacity={0.2} strokeDasharray="3 3" />
        </>
      )}

      {/* Ghost dots (starting positions) */}
      <circle cx={ghx} cy={ghy} r={6} fill="none" stroke="#f59e0b" strokeWidth={1.5} opacity={0.25} />
      <circle cx={ggx} cy={ggy} r={6} fill="none" stroke="#06b6d4" strokeWidth={1.5} opacity={0.25} />

      {/* Connecting line between current positions */}
      <line
        x1={hx} y1={hy} x2={gx} y2={gy}
        stroke="hsl(var(--foreground))"
        strokeWidth={isClose ? 2 : 1}
        strokeDasharray={isClose ? 'none' : '6 4'}
        opacity={0.3}
      />

      {/* Phase label on connecting line */}
      <rect x={mx - 30} y={my - 8} width={60} height={16} rx={4} fill="hsl(var(--background))" stroke="hsl(var(--border))" strokeWidth={0.5} />
      <text x={mx} y={my + 1} textAnchor="middle" fontSize={8} fill="hsl(var(--muted-foreground))" dominantBaseline="middle">
        {PHASE_LABELS[phase] || phase}
      </text>

      {/* Current HOST dot */}
      <circle cx={hx} cy={hy} r={10} fill="#f59e0b" opacity={0.9} />
      <text x={hx} y={hy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="white" fontWeight="bold">H</text>
      <text x={hx} y={hy - 16} textAnchor="middle" fontSize={9} fill="#f59e0b" fontWeight="600">HOST</text>

      {/* Current GUEST dot */}
      <circle cx={gx} cy={gy} r={10} fill="#06b6d4" opacity={0.9} />
      <text x={gx} y={gy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="white" fontWeight="bold">G</text>
      <text x={gx} y={gy - 16} textAnchor="middle" fontSize={9} fill="#06b6d4" fontWeight="600">GUEST</text>

      {/* No data overlay */}
      {!personality && (
        <text x={W / 2} y={H / 2 + 50} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))" opacity={0.6}>
          Startpositionen — noch keine Episoden
        </text>
      )}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function AudioPage() {
  const [ttsSettings, setTtsSettings] = useState<TTSSettings | null>(null)
  const [ttsLoading, setTtsLoading] = useState(true)
  const [ttsSaving, setTtsSaving] = useState(false)
  const [ttsSuccess, setTtsSuccess] = useState(false)
  const [activeTab, setActiveTab] = useState('episode')

  // Podcast-specific state
  const [podcastDuration, setPodcastDuration] = useState(30)
  const [podcastScript, setPodcastScript] = useState(EXAMPLE_PODCAST_SCRIPT)
  const [podcastGenerating, setPodcastGenerating] = useState(false)
  const [podcastAudioUrl, setPodcastAudioUrl] = useState<string | null>(null)
  const [podcastError, setPodcastError] = useState<string | null>(null)
  const [podcastDurationSeconds, setPodcastDurationSeconds] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Provider & voice state
  const [podcastProvider, setPodcastProvider] = useState<PodcastProvider>('openai')
  const [openaiHostVoice, setOpenaiHostVoice] = useState<TTSVoice>('shimmer')
  const [openaiGuestVoice, setOpenaiGuestVoice] = useState<TTSVoice>('fable')
  const [openaiModel, setOpenaiModel] = useState<TTSModel>('tts-1-hd')

  // Stereo mixing data
  const [segmentUrls, setSegmentUrls] = useState<string[]>([])
  const [segmentMetadata, setSegmentMetadata] = useState<SegmentMetadata[]>([])

  // Post selection for script generation
  const [recentPosts, setRecentPosts] = useState<Array<{ id: string; title: string; slug: string; created_at: string }>>([])
  const [selectedPostId, setSelectedPostId] = useState<string>('')
  const [selectedLocale, setSelectedLocale] = useState<PodcastLocale>('en')
  const [scriptGenerating, setScriptGenerating] = useState(false)
  const [customPrompt, setCustomPrompt] = useState(PODCAST_SCRIPT_PROMPT)
  const [scriptGenerated, setScriptGenerated] = useState(false)
  const [scriptModified, setScriptModified] = useState(false)

  // Personality state
  const [personality, setPersonality] = useState<PersonalityState | null>(null)
  const [personalityLoading, setPersonalityLoading] = useState(false)

  // Job-based podcast generation state
  const [podcastJobId, setPodcastJobId] = useState<string | null>(null)
  const [podcastProgress, setPodcastProgress] = useState(0)
  const [podcastCurrentLine, setPodcastCurrentLine] = useState(0)
  const [podcastTotalLines, setPodcastTotalLines] = useState(0)

  // Estimated word count
  const estimatedWordCount = Math.round(podcastDuration * 150)

  // Script line count
  const scriptLineCount = podcastScript.split('\n').filter(line =>
    line.trim().match(/^(HOST|GUEST):/i)
  ).length

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  useEffect(() => {
    fetchTTSSettings()
    fetchRecentPosts()
  }, [])

  // Fetch personality when Character tab becomes active
  useEffect(() => {
    if (activeTab === 'character' && !personality && !personalityLoading) {
      fetchPersonality()
    }
  }, [activeTab])

  const fetchPersonality = useCallback(async () => {
    setPersonalityLoading(true)
    try {
      const res = await fetch('/api/admin/podcast-personality?locale=de')
      if (res.ok) {
        const data = await res.json()
        setPersonality(data.personality)
      }
    } catch (err) {
      console.error('Error fetching personality:', err)
    } finally {
      setPersonalityLoading(false)
    }
  }, [])

  async function fetchRecentPosts() {
    try {
      const res = await fetch('/api/admin/posts?limit=20&published=true')
      if (res.ok) {
        const data = await res.json()
        const posts = data.posts || []
        setRecentPosts(posts)
        if (posts.length > 0 && !selectedPostId) {
          setSelectedPostId(posts[0].id)
        }
      }
    } catch (error) {
      console.error('Error fetching posts:', error)
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

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

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
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Script-Generierung fehlgeschlagen')
      setPodcastScript(data.script)
      setScriptGenerated(true)
      setScriptModified(false)
      setPodcastAudioUrl(null)
    } catch (error) {
      console.error('Script generation error:', error)
      setPodcastError(error instanceof Error ? error.message : 'Unbekannter Fehler')
    } finally {
      setScriptGenerating(false)
    }
  }

  async function generatePodcast() {
    if (!podcastScript.trim()) {
      setPodcastError('Bitte gib ein Script ein')
      return
    }
    setPodcastGenerating(true)
    setPodcastError(null)
    setPodcastAudioUrl(null)
    setPodcastProgress(0)
    setPodcastCurrentLine(0)

    try {
      const requestBody = podcastProvider === 'openai'
        ? {
            script: podcastScript,
            hostVoiceId: openaiHostVoice,
            guestVoiceId: openaiGuestVoice,
            provider: 'openai' as const,
            model: openaiModel,
            title: selectedPostId ? `podcast-${selectedPostId}` : `test-podcast-${Date.now()}`,
            postId: selectedPostId || undefined,
            sourceLocale: selectedLocale,
          }
        : {
            script: podcastScript,
            hostVoiceId: ttsSettings?.podcast_host_voice_id,
            guestVoiceId: ttsSettings?.podcast_guest_voice_id,
            model: ttsSettings?.elevenlabs_model || 'eleven_v3',
            provider: 'elevenlabs' as const,
            title: selectedPostId ? `podcast-${selectedPostId}` : `test-podcast-${Date.now()}`,
            postId: selectedPostId || undefined,
            sourceLocale: selectedLocale,
          }

      const createRes = await fetch('/api/podcast/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      })
      const createData = await createRes.json()
      if (!createRes.ok) throw new Error(createData.error || 'Job-Erstellung fehlgeschlagen')

      const jobId = createData.jobId
      setPodcastJobId(jobId)
      setPodcastTotalLines(createData.totalLines)

      fetch('/api/podcast/jobs/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ jobId }),
      }).catch(err => console.error('[Podcast] Process trigger failed:', err))

      let completed = false
      while (!completed) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        const statusRes = await fetch(`/api/podcast/jobs/${jobId}`, { credentials: 'include' })
        const status = await statusRes.json()
        if (!statusRes.ok) throw new Error(status.error || 'Status-Abfrage fehlgeschlagen')

        setPodcastProgress(status.progress || 0)
        setPodcastCurrentLine(status.currentLine || 0)
        setPodcastTotalLines(status.totalLines || 0)

        if (status.status === 'completed') {
          completed = true
          setPodcastAudioUrl(status.audioUrl)
          setPodcastDurationSeconds(status.durationSeconds)
          if (status.segmentUrls && status.segmentMetadata) {
            setSegmentUrls(status.segmentUrls)
            setSegmentMetadata(status.segmentMetadata)
          } else {
            setSegmentUrls([])
            setSegmentMetadata([])
          }
        } else if (status.status === 'failed') {
          throw new Error(status.errorMessage || 'Podcast-Generierung fehlgeschlagen')
        }
      }
    } catch (error) {
      console.error('Podcast generation error:', error)
      setPodcastError(error instanceof Error ? error.message : 'Unbekannter Fehler')
    } finally {
      setPodcastGenerating(false)
      setPodcastJobId(null)
    }
  }

  function togglePlayback() {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tighter flex items-center gap-3">
          <Volume2 className="h-8 w-8" />
          Audio
        </h1>
        <p className="mt-1 text-muted-foreground">
          Podcast-Episoden, Aufnahme-Einstellungen und Charakter-Entwicklung
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="episode" className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Episode
          </TabsTrigger>
          <TabsTrigger value="recording" className="flex items-center gap-2">
            <Mic className="h-4 w-4" />
            Recording
          </TabsTrigger>
          <TabsTrigger value="character" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Character
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* EPISODE TAB                                                      */}
        {/* ================================================================ */}
        <TabsContent value="episode" className="space-y-6">
          {/* Episode Script */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Episode Script
              </CardTitle>
              <CardDescription>
                Generiere ein Podcast-Script aus einem Blog-Post oder teste mit einem eigenen Script
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Post Selection */}
              <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
                <Label className="text-sm font-medium">Script aus Post generieren</Label>
                <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
                  <Select value={selectedPostId} onValueChange={setSelectedPostId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Post auswählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      {recentPosts.map((post) => (
                        <SelectItem key={post.id} value={post.id}>
                          <span className="truncate max-w-[300px] block">{post.title}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={selectedLocale} onValueChange={(v) => setSelectedLocale(v as PodcastLocale)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PODCAST_LOCALES.map((loc) => (
                        <SelectItem key={loc.code} value={loc.code}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button onClick={generateScriptFromPost} disabled={scriptGenerating || !selectedPostId} variant="secondary">
                    {scriptGenerating ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generiere...</>
                    ) : (
                      <><Sparkles className="mr-2 h-4 w-4" />Script generieren</>
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
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium">Script</Label>
                    {scriptGenerated && scriptModified && (
                      <Badge variant="outline" className="text-xs text-yellow-700 border-yellow-400">bearbeitet</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileText className="h-3 w-3" />
                    {scriptLineCount} Zeilen
                  </div>
                </div>
                <Textarea
                  value={podcastScript}
                  onChange={(e) => {
                    setPodcastScript(e.target.value)
                    if (scriptGenerated) setScriptModified(true)
                  }}
                  placeholder="HOST: [cheerfully] Welcome to the show!&#10;GUEST: [thoughtfully] Thanks for having me..."
                  className="font-mono text-sm h-[300px]"
                />
                <p className="text-xs text-muted-foreground">
                  Format: <code className="bg-muted px-1 rounded">HOST:</code> oder <code className="bg-muted px-1 rounded">GUEST:</code> gefolgt von optionalen Emotion-Tags wie <code className="bg-muted px-1 rounded">[cheerfully]</code>.
                </p>
              </div>

              {/* Generate Button & Status */}
              <div className="flex items-center gap-4">
                <Button onClick={generatePodcast} disabled={podcastGenerating || !podcastScript.trim()} className="min-w-[180px]">
                  {podcastGenerating ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generiere...</>
                  ) : (
                    <><Sparkles className="mr-2 h-4 w-4" />Podcast generieren</>
                  )}
                </Button>

                {podcastGenerating && podcastTotalLines > 0 && (
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Zeile {podcastCurrentLine} / {podcastTotalLines}</span>
                      <span className="font-medium">{podcastProgress}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary transition-all duration-300" style={{ width: `${podcastProgress}%` }} />
                    </div>
                  </div>
                )}
                {podcastGenerating && podcastTotalLines === 0 && (
                  <span className="text-sm text-muted-foreground">Starte Job...</span>
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
                <div className="space-y-4">
                  {segmentUrls.length > 0 && segmentMetadata.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <Headphones className="h-4 w-4 text-green-500" />
                        <span className="font-medium text-green-600">Stereo Player</span>
                        <span className="text-muted-foreground">(HOST 65% links, GUEST 65% rechts)</span>
                      </div>
                      <StereoPodcastPlayer segmentUrls={segmentUrls} segmentMetadata={segmentMetadata} title="test-podcast" />
                    </div>
                  ) : (
                    <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Button variant="outline" size="icon" onClick={togglePlayback} className="h-10 w-10">
                            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                          </Button>
                          <div>
                            <p className="text-sm font-medium">Podcast Preview (Mono)</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {podcastDurationSeconds ? `~${Math.floor(podcastDurationSeconds / 60)}:${String(podcastDurationSeconds % 60).padStart(2, '0')}` : 'Unbekannt'}
                            </p>
                          </div>
                        </div>
                        <a href={podcastAudioUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">
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
                        <Badge key={tag} variant="outline" className="font-mono text-xs">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setCustomPrompt(PODCAST_SCRIPT_PROMPT)} disabled={customPrompt === PODCAST_SCRIPT_PROMPT}>
                      Zurücksetzen
                    </Button>
                    <Button size="sm" onClick={saveTTSSettings} disabled={ttsSaving}>
                      {ttsSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
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

        {/* ================================================================ */}
        {/* RECORDING TAB                                                    */}
        {/* ================================================================ */}
        <TabsContent value="recording" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="h-5 w-5" />
                Podcast-Einstellungen
              </CardTitle>
              <CardDescription>
                Wähle zwischen OpenAI TTS (~10x günstiger) oder ElevenLabs (mit Emotion-Tags)
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
                  {/* Provider Selection */}
                  <div className="space-y-3 p-4 bg-primary/5 rounded-lg border-2 border-primary/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-base font-semibold">TTS Provider</Label>
                        <p className="text-sm text-muted-foreground">
                          OpenAI: ~$0.20/Podcast | ElevenLabs: ~$3.00/Podcast
                        </p>
                      </div>
                      <Select value={podcastProvider} onValueChange={(v) => setPodcastProvider(v as PodcastProvider)}>
                        <SelectTrigger className="w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openai">OpenAI TTS (~10x günstiger)</SelectItem>
                          <SelectItem value="elevenlabs">ElevenLabs (Emotion-Tags)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {podcastProvider === 'openai' && (
                      <Alert className="bg-yellow-500/10 border-yellow-500/30">
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        <AlertDescription className="text-sm">
                          OpenAI TTS unterstützt keine Emotion-Tags. Tags wie <code className="bg-muted px-1 rounded">[cheerfully]</code> werden automatisch entfernt.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>

                  {/* OpenAI Settings */}
                  {podcastProvider === 'openai' && (
                    <>
                      <div className="space-y-2 pb-4 border-b">
                        <Label className="text-base">OpenAI Model</Label>
                        <Select value={openaiModel} onValueChange={(v) => setOpenaiModel(v as TTSModel)}>
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="tts-1">tts-1 (schnell, günstiger)</SelectItem>
                            <SelectItem value="tts-1-hd">tts-1-hd (HD Qualität)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-4 pb-4 border-b">
                        <Label className="text-base">OpenAI Stimmen</Label>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label className="text-sm">Host (News)</Label>
                            <Select value={openaiHostVoice} onValueChange={(v) => setOpenaiHostVoice(v as TTSVoice)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {OPENAI_PODCAST_VOICES.map((voice) => (
                                  <SelectItem key={voice.id} value={voice.id}>{voice.name} - {voice.description}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">Guest (Synthszr)</Label>
                            <Select value={openaiGuestVoice} onValueChange={(v) => setOpenaiGuestVoice(v as TTSVoice)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {OPENAI_PODCAST_VOICES.map((voice) => (
                                  <SelectItem key={voice.id} value={voice.id}>{voice.name} - {voice.description}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* ElevenLabs Settings */}
                  {podcastProvider === 'elevenlabs' && (
                    <>
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

                      <div className="space-y-2 pb-4 border-b">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-base">ElevenLabs Model</Label>
                            <p className="text-sm text-muted-foreground">
                              Eleven v3 unterstützt Audio-Tags wie [cheerfully], [whispers], [sighs]
                            </p>
                          </div>
                          <Select
                            value={ttsSettings.elevenlabs_model || 'eleven_v3'}
                            onValueChange={(value: ElevenLabsModel) => setTtsSettings({ ...ttsSettings, elevenlabs_model: value })}
                          >
                            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="eleven_v3">Eleven v3 (empfohlen)</SelectItem>
                              <SelectItem value="eleven_multilingual_v2">Multilingual v2</SelectItem>
                              <SelectItem value="eleven_turbo_v2_5">Turbo v2.5 (schnell)</SelectItem>
                              <SelectItem value="eleven_turbo_v2">Turbo v2</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* German Voices */}
                      <div className="space-y-4 pb-4 border-b">
                        <div className="flex items-center gap-2">
                          <Badge variant="default">DE</Badge>
                          <Label className="text-base">Deutsche Stimmen</Label>
                        </div>
                        <p className="text-sm text-muted-foreground">Verwendet für: Deutsch (de)</p>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label className="text-sm">Host (News)</Label>
                            <Select
                              value={ttsSettings.podcast_host_voice_de || ttsSettings.podcast_host_voice_id || 'XrExE9yKIg1WjnnlVkGX'}
                              onValueChange={(value: string) => setTtsSettings({ ...ttsSettings, podcast_host_voice_de: value })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {PODCAST_VOICES_DE.map((voice) => (
                                  <SelectItem key={voice.id} value={voice.id}>{voice.name} - {voice.description}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">Guest (Synthszr)</Label>
                            <Select
                              value={ttsSettings.podcast_guest_voice_de || ttsSettings.podcast_guest_voice_id || 'g5CIjZEefAph4nQFvHAz'}
                              onValueChange={(value: string) => setTtsSettings({ ...ttsSettings, podcast_guest_voice_de: value })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {PODCAST_VOICES_DE.map((voice) => (
                                  <SelectItem key={voice.id} value={voice.id}>{voice.name} - {voice.description}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      {/* English Voices */}
                      <div className="space-y-4 pb-4 border-b">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">EN</Badge>
                          <Label className="text-base">Englische Stimmen</Label>
                        </div>
                        <p className="text-sm text-muted-foreground">Verwendet für: English (en), Čeština (cs), Plattdüütsch (nds)</p>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label className="text-sm">Host (News)</Label>
                            <Select
                              value={ttsSettings.podcast_host_voice_en || 'pFZP5JQG7iQjIQuC4Bku'}
                              onValueChange={(value: string) => setTtsSettings({ ...ttsSettings, podcast_host_voice_en: value })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {PODCAST_VOICES_EN.map((voice) => (
                                  <SelectItem key={voice.id} value={voice.id}>{voice.name} - {voice.description}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">Guest (Synthszr)</Label>
                            <Select
                              value={ttsSettings.podcast_guest_voice_en || 'onwK4e9ZLuTAKqWW03F9'}
                              onValueChange={(value: string) => setTtsSettings({ ...ttsSettings, podcast_guest_voice_en: value })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {PODCAST_VOICES_EN.map((voice) => (
                                  <SelectItem key={voice.id} value={voice.id}>{voice.name} - {voice.description}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Duration Slider */}
                  <div className="space-y-4 pb-4 border-b">
                    <div>
                      <Label className="text-base">Podcast-Länge</Label>
                      <p className="text-sm text-muted-foreground">Ziel-Dauer des generierten Podcasts</p>
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
                        <Badge variant="secondary" className="text-sm">{podcastDuration} Minuten</Badge>
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
                      {ttsSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Einstellungen speichern
                    </Button>
                    {ttsSuccess && (
                      <span className="text-sm text-green-600 flex items-center gap-1">
                        <CheckCircle className="h-4 w-4" />
                        Gespeichert
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Einstellungen konnten nicht geladen werden.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================ */}
        {/* CHARACTER TAB                                                    */}
        {/* ================================================================ */}
        <TabsContent value="character" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Podcast-Persönlichkeiten
              </CardTitle>
              <CardDescription>
                HOST und GUEST entwickeln sich von Episode zu Episode weiter. Persönlichkeitsdimensionen driften per Random Walk zu phasenbasierten Zielen.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {personalityLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Lade Persönlichkeitsdaten...</span>
                </div>
              ) : (
                <>
                  {/* Status Bar */}
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="default" className="text-sm">
                      Episode #{personality ? personality.episode_count : 0}
                    </Badge>
                    <Badge variant="secondary" className="text-sm">
                      {PHASE_LABELS[personality?.relationship_phase || 'strangers']}
                    </Badge>
                    {personality && personality.inside_joke_count > 0 && (
                      <Badge variant="outline" className="text-sm">
                        {personality.inside_joke_count} Inside Jokes
                      </Badge>
                    )}
                    <Button variant="ghost" size="sm" onClick={fetchPersonality} className="ml-auto">
                      <Loader2 className={`h-3 w-3 mr-1 ${personalityLoading ? 'animate-spin' : ''}`} />
                      Aktualisieren
                    </Button>
                  </div>

                  {/* Personality Map */}
                  <div className="border rounded-lg p-4 bg-background">
                    <PersonalityMap personality={personality} />
                  </div>

                  {/* Stats Grid */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {/* Comfort Meter */}
                    <div className="space-y-2 p-4 rounded-lg border">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Komfort-Level</Label>
                        <span className="text-sm font-mono text-muted-foreground">
                          {Math.round((personality?.mutual_comfort ?? 0.2) * 100)}%
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 transition-all duration-500"
                          style={{ width: `${(personality?.mutual_comfort ?? 0.2) * 100}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Bestimmt den Phasenübergang (Fremde → Bekannte → Kollegen → ...)
                      </p>
                    </div>

                    {/* Flirtation Meter */}
                    <div className="space-y-2 p-4 rounded-lg border">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Flirt-Tendenz</Label>
                        <span className="text-sm font-mono text-muted-foreground">
                          {Math.round((personality?.flirtation_tendency ?? 0) * 100)}%
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-pink-400 transition-all duration-500"
                          style={{ width: `${(personality?.flirtation_tendency ?? 0) * 100}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Wie oft persönliche Momente aufkommen — werden dann als &quot;nur KI&quot; abgewürgt
                      </p>
                    </div>
                  </div>

                  {/* Dimension Details */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-3 p-4 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-amber-500" />
                        <Label className="text-sm font-semibold">HOST</Label>
                      </div>
                      <DimensionBar label="Wärme" value={personality?.host_warmth ?? 0.5} />
                      <DimensionBar label="Humor" value={personality?.host_humor ?? 0.4} />
                      <DimensionBar label="Formalität" value={personality?.host_formality ?? 0.6} />
                      <DimensionBar label="Neugier" value={personality?.host_curiosity ?? 0.7} />
                      <DimensionBar label="KI-Bewusstsein" value={personality?.host_self_awareness ?? 0.2} />
                    </div>

                    <div className="space-y-3 p-4 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-cyan-500" />
                        <Label className="text-sm font-semibold">GUEST</Label>
                      </div>
                      <DimensionBar label="Selbstvertrauen" value={personality?.guest_confidence ?? 0.6} />
                      <DimensionBar label="Verspieltheit" value={personality?.guest_playfulness ?? 0.3} />
                      <DimensionBar label="Direktheit" value={personality?.guest_directness ?? 0.7} />
                      <DimensionBar label="Empathie" value={personality?.guest_empathy ?? 0.4} />
                      <DimensionBar label="KI-Bewusstsein" value={personality?.guest_self_awareness ?? 0.2} />
                    </div>
                  </div>

                  {/* Memorable Moments */}
                  {personality && personality.memorable_moments.length > 0 && (
                    <div className="space-y-3 p-4 rounded-lg border">
                      <Label className="text-sm font-semibold">Bemerkenswerte Momente</Label>
                      <div className="space-y-2">
                        {personality.memorable_moments.map((m, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm">
                            <Badge variant="outline" className="text-xs shrink-0 mt-0.5">#{m.episode}</Badge>
                            <span className="text-muted-foreground italic">&ldquo;{m.text}&rdquo;</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!personality && (
                    <Alert className="bg-muted/50">
                      <Info className="h-4 w-4" />
                      <AlertDescription className="text-sm">
                        Noch keine Episoden generiert. Die Persönlichkeiten starten bei den Standardwerten und entwickeln sich ab der ersten Episode.
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small Dimension Bar Component
// ---------------------------------------------------------------------------

function DimensionBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-mono text-muted-foreground">{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-foreground/30 rounded-full transition-all duration-500"
          style={{ width: `${value * 100}%` }}
        />
      </div>
    </div>
  )
}
