'use client'

import { Suspense, useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Volume2, Mic, CheckCircle, Loader2, Save, Play, AlertTriangle, Info, Pause, Sparkles, Clock, FileText, Headphones, Users, SlidersHorizontal, RotateCcw, Database, MessageSquare, BrainCircuit, ArrowRight, TrendingUp, BookOpen, History } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { AudioFileManager, type AudioFile } from '@/components/admin/audio-file-manager'
import { PodcastTimeMachine } from '@/components/admin/podcast-time-machine'
import { EnvelopeEditor } from '@/components/admin/envelope-editor'
import type { AudioEnvelope } from '@/lib/audio/envelope'
import { legacyIntroToEnvelopes, legacyOutroToEnvelopes } from '@/lib/audio/envelope'

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
  mixing_settings: MixingSettings | null
}

type CurveType = 'linear' | 'exponential'

interface MixingSettings {
  intro_enabled: boolean
  intro_full_sec: number
  intro_bed_sec: number
  intro_bed_volume: number
  intro_fadeout_sec: number
  intro_dialog_fadein_sec: number
  intro_fadeout_curve: CurveType
  intro_dialog_curve: CurveType
  outro_enabled: boolean
  outro_crossfade_sec: number
  outro_rise_sec: number
  outro_bed_volume: number
  outro_final_start_sec: number
  outro_rise_curve: CurveType
  outro_final_curve: CurveType
  stereo_host: number
  stereo_guest: number
  overlap_reaction_ms: number
  overlap_interrupt_ms: number
  overlap_question_ms: number
  overlap_speaker_ms: number
  // Envelope-based mixing (takes precedence when present)
  intro_music_envelope?: AudioEnvelope
  intro_dialog_envelope?: AudioEnvelope
  outro_music_envelope?: AudioEnvelope
  outro_dialog_envelope?: AudioEnvelope
}

const DEFAULT_MIXING: MixingSettings = {
  intro_enabled: true,
  intro_full_sec: 3,
  intro_bed_sec: 7,
  intro_bed_volume: 20,
  intro_fadeout_sec: 3,
  intro_dialog_fadein_sec: 1,
  intro_fadeout_curve: 'exponential',
  intro_dialog_curve: 'exponential',
  outro_enabled: true,
  outro_crossfade_sec: 10,
  outro_rise_sec: 3,
  outro_bed_volume: 20,
  outro_final_start_sec: 7,
  outro_rise_curve: 'exponential',
  outro_final_curve: 'exponential',
  stereo_host: 35,
  stereo_guest: 65,
  overlap_reaction_ms: 250,
  overlap_interrupt_ms: 180,
  overlap_question_ms: 80,
  overlap_speaker_ms: 50,
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
  self_irony: number
  inside_joke_count: number
  host_name: string | null
  relationship_paused: boolean
  current_mood: string
  memorable_moments: Array<{ episode: number; text: string; type?: string }>
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

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function PersonalityMap({ personality }: { personality: PersonalityState | null }) {
  const W = 800
  const H = 400
  const PAD_X = 70
  const PAD_Y = 40
  const innerW = W - PAD_X * 2
  const innerH = H - PAD_Y * 2

  const state = personality || DEFAULT_PERSONALITY as PersonalityState

  const hostPos = calcPosition(state, 'host')
  const guestPos = calcPosition(state, 'guest')
  const ghostHost = calcPosition(DEFAULT_PERSONALITY, 'host')
  const ghostGuest = calcPosition(DEFAULT_PERSONALITY, 'guest')

  // Map 0..1 to SVG coordinates
  const toSvgX = (v: number) => PAD_X + v * innerW
  const toSvgY = (v: number) => PAD_Y + (1 - v) * innerH // Invert Y

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

  // Tooltip texts
  const startDate = personality ? formatDate(personality.created_at) : null
  const lastDate = personality ? formatDate(personality.last_episode_at) : null
  const epCount = personality?.episode_count ?? 0

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ fontFamily: 'var(--font-mono, monospace)' }}>
      {/* Background */}
      <rect x={PAD_X} y={PAD_Y} width={innerW} height={innerH} fill="hsl(var(--muted))" rx={8} opacity={0.3} />

      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map((v) => (
        <g key={v}>
          <line x1={toSvgX(v)} y1={PAD_Y} x2={toSvgX(v)} y2={H - PAD_Y} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="4 4" />
          <line x1={PAD_X} y1={toSvgY(v)} x2={W - PAD_X} y2={toSvgY(v)} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="4 4" />
        </g>
      ))}

      {/* Center axes */}
      <line x1={toSvgX(0.5)} y1={PAD_Y} x2={toSvgX(0.5)} y2={H - PAD_Y} stroke="hsl(var(--foreground))" strokeWidth={1} opacity={0.15} />
      <line x1={PAD_X} y1={toSvgY(0.5)} x2={W - PAD_X} y2={toSvgY(0.5)} stroke="hsl(var(--foreground))" strokeWidth={1} opacity={0.15} />

      {/* Axis labels */}
      <text x={PAD_X - 8} y={H / 2} textAnchor="end" fontSize={11} fill="hsl(var(--muted-foreground))" dominantBaseline="middle" style={{ letterSpacing: '0.05em' }}>
        Rational
      </text>
      <text x={W - PAD_X + 8} y={H / 2} textAnchor="start" fontSize={11} fill="hsl(var(--muted-foreground))" dominantBaseline="middle" style={{ letterSpacing: '0.05em' }}>
        Emotional
      </text>
      <text x={W / 2} y={PAD_Y - 14} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))" style={{ letterSpacing: '0.05em' }}>
        Expressiv
      </text>
      <text x={W / 2} y={H - PAD_Y + 20} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))" style={{ letterSpacing: '0.05em' }}>
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
      <g>
        <circle cx={ghx} cy={ghy} r={6} fill="none" stroke="#f59e0b" strokeWidth={1.5} opacity={0.25} />
        {startDate && <title>HOST Start — {startDate}</title>}
      </g>
      <g>
        <circle cx={ggx} cy={ggy} r={6} fill="none" stroke="#06b6d4" strokeWidth={1.5} opacity={0.25} />
        {startDate && <title>GUEST Start — {startDate}</title>}
      </g>

      {/* Connecting line between current positions */}
      <line
        x1={hx} y1={hy} x2={gx} y2={gy}
        stroke="hsl(var(--foreground))"
        strokeWidth={isClose ? 2 : 1}
        strokeDasharray={isClose ? 'none' : '6 4'}
        opacity={0.3}
      />

      {/* Phase label on connecting line */}
      <rect x={mx - 36} y={my - 9} width={72} height={18} rx={4} fill="hsl(var(--background))" stroke="hsl(var(--border))" strokeWidth={0.5} />
      <text x={mx} y={my + 1} textAnchor="middle" fontSize={9} fill="hsl(var(--muted-foreground))" dominantBaseline="middle">
        {PHASE_LABELS[phase] || phase}
      </text>

      {/* Current HOST dot */}
      <g className="cursor-default">
        <circle cx={hx} cy={hy} r={10} fill="#f59e0b" opacity={0.9} />
        <text x={hx} y={hy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="white" fontWeight="bold">H</text>
        <title>{`HOST — Episode #${epCount}${lastDate ? `\n${lastDate}` : ''}`}</title>
      </g>
      <text x={hx} y={hy - 16} textAnchor="middle" fontSize={9} fill="#f59e0b" fontWeight="600">HOST</text>

      {/* Current GUEST dot */}
      <g className="cursor-default">
        <circle cx={gx} cy={gy} r={10} fill="#06b6d4" opacity={0.9} />
        <text x={gx} y={gy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="white" fontWeight="bold">G</text>
        <title>{`GUEST — Episode #${epCount}${lastDate ? `\n${lastDate}` : ''}`}</title>
      </g>
      <text x={gx} y={gy - 16} textAnchor="middle" fontSize={9} fill="#06b6d4" fontWeight="600">GUEST</text>

      {/* No data overlay */}
      {!personality && (
        <text x={W / 2} y={H / 2 + 50} textAnchor="middle" fontSize={12} fill="hsl(var(--muted-foreground))" opacity={0.6}>
          Startpositionen — noch keine Episoden
        </text>
      )}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Personality Pipeline Visualization
// ---------------------------------------------------------------------------

function PipelineStep({ icon, title, description, active, detail }: {
  icon: React.ReactNode
  title: string
  description: string
  active?: boolean
  detail?: string
}) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${active ? 'border-green-500/50 bg-green-500/5' : 'border-border'}`}>
      <div className={`shrink-0 mt-0.5 ${active ? 'text-green-500' : 'text-muted-foreground'}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          {active && <span className="text-[10px] text-green-600 font-mono">AKTIV</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        {detail && (
          <p className="text-xs font-mono text-foreground/60 mt-1 bg-muted/50 px-2 py-1 rounded">{detail}</p>
        )}
      </div>
    </div>
  )
}

function PipelineArrow() {
  return (
    <div className="flex justify-center py-0.5">
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 rotate-90" />
    </div>
  )
}

function PersonalityPipeline({ personality }: { personality: PersonalityState | null }) {
  const ep = personality?.episode_count ?? 0
  const phase = personality?.relationship_phase ?? 'strangers'
  const hasMemories = (personality?.memorable_moments?.length ?? 0) > 0
  const comfort = personality?.mutual_comfort ?? 0.2

  // Determine next phase threshold
  const thresholds: Record<string, { next: string; threshold: number }> = {
    strangers: { next: 'Bekannte', threshold: 0.3 },
    acquaintances: { next: 'Kollegen', threshold: 0.5 },
    colleagues: { next: 'Freunde', threshold: 0.7 },
    friends: { next: 'Enge Freunde', threshold: 0.85 },
    close_friends: { next: '—', threshold: 1.0 },
  }
  const nextInfo = thresholds[phase] ?? thresholds.strangers

  const phaseOrder = ['strangers', 'acquaintances', 'colleagues', 'friends', 'close_friends']
  const currentIdx = phaseOrder.indexOf(phase)
  const currentThreshold = [0, 0.3, 0.5, 0.7, 0.85][currentIdx] ?? 0
  const nextThreshold = nextInfo.threshold
  const bracketProgress = phase === 'close_friends'
    ? 100
    : Math.min(100, Math.max(0, Math.round(((comfort - currentThreshold) / (nextThreshold - currentThreshold)) * 100)))

  return (
    <div className="space-y-1">
      <PipelineStep
        icon={<Database className="h-4 w-4" />}
        title="1. State laden"
        description="PersonalityState wird aus podcast_personality_state geladen (pro Locale)"
        active={ep > 0}
        detail={ep > 0 ? `Episode #${ep} · Phase: ${PHASE_LABELS[phase]} · Comfort: ${Math.round(comfort * 100)}%` : 'Noch keine Episoden — Defaults werden verwendet'}
      />
      <PipelineArrow />
      <PipelineStep
        icon={<MessageSquare className="h-4 w-4" />}
        title="2. Personality Brief generieren"
        description="buildPersonalityBrief() erzeugt HOST/GUEST-Traits, KI-Bewusstsein, Beziehungsdynamik als Prompt-Block"
        active={ep > 0}
        detail={ep > 0 ? `Traits: Warmth=${Math.round((personality?.host_warmth ?? 0.5) * 100)}%, Humor=${Math.round((personality?.host_humor ?? 0.4) * 100)}%, ...` : undefined}
      />
      <PipelineArrow />
      <PipelineStep
        icon={<BrainCircuit className="h-4 w-4" />}
        title="3. Prompt zusammenfügen"
        description="Standard-Script-Prompt + Personality Brief → fullPrompt an Claude/Gemini"
        active
        detail="fullPrompt = scriptPrompt + personalityBrief"
      />
      <PipelineArrow />
      <PipelineStep
        icon={<FileText className="h-4 w-4" />}
        title="4. Script generieren"
        description="AI generiert HOST/GUEST-Dialog mit eingewobenen Persönlichkeitsmomenten (max 2-3 pro Episode)"
        active
      />
      <PipelineArrow />
      <PipelineStep
        icon={<BookOpen className="h-4 w-4" />}
        title="5. Moments extrahieren"
        description="extractMemorableMoments() durchsucht das Script nach Witzen, Versprechern, KI-Momenten, persönlichen Momenten"
        active={hasMemories}
        detail={hasMemories ? `${personality!.memorable_moments.length} Momente gespeichert (FIFO, max 7)` : 'Noch keine Momente extrahiert'}
      />
      <PipelineArrow />
      <PipelineStep
        icon={<TrendingUp className="h-4 w-4" />}
        title="6. Personality evolvieren"
        description="advanceState() → Random Walk (drift=0.1, noise=0.03) in Richtung Phase-Targets. Prüft Phasenübergang."
        active={ep > 0}
        detail={phase !== 'close_friends'
          ? `Nächste Phase: ${nextInfo.next} bei Comfort ≥ ${Math.round(nextInfo.threshold * 100)}% (aktuell: ${Math.round(comfort * 100)}% — ${bracketProgress}% der Strecke)`
          : 'Maximale Phase erreicht'}
      />
      <PipelineArrow />
      <PipelineStep
        icon={<Database className="h-4 w-4" />}
        title="7. State speichern"
        description="Evolvierter State wird zurück in podcast_personality_state geschrieben → bereit für nächste Episode"
        active={ep > 0}
        detail={personality?.last_episode_at ? `Letztes Update: ${formatDate(personality.last_episode_at)}` : undefined}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Moment Type Badges
// ---------------------------------------------------------------------------

const MOMENT_TYPE_STYLES: Record<string, { label: string; color: string }> = {
  joke: { label: 'Witz', color: 'bg-yellow-500/20 text-yellow-700' },
  slip_up: { label: 'Versprecher', color: 'bg-orange-500/20 text-orange-700' },
  ai_reflection: { label: 'KI', color: 'bg-blue-500/20 text-blue-700' },
  personal: { label: 'Persönlich', color: 'bg-pink-500/20 text-pink-700' },
  callback: { label: 'Callback', color: 'bg-green-500/20 text-green-700' },
  insight: { label: 'Einsicht', color: 'bg-emerald-500/20 text-emerald-700' },
  milestone: { label: 'Meilenstein', color: 'bg-purple-500/20 text-purple-700' },
}

const DEFAULT_MOMENT_STYLE = { label: 'Moment', color: 'bg-gray-500/20 text-gray-700' }

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function AudioPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <AudioPage />
    </Suspense>
  )
}

function AudioPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [ttsSettings, setTtsSettings] = useState<TTSSettings | null>(null)
  const [ttsLoading, setTtsLoading] = useState(true)
  const [ttsSaving, setTtsSaving] = useState(false)
  const [ttsSuccess, setTtsSuccess] = useState(false)

  // Sync active tab with URL ?tab= param
  const validTabs = useMemo(() => new Set(['episode', 'recording', 'character', 'timemachine']), [])
  const tabFromUrl = searchParams.get('tab')
  const activeTab = validTabs.has(tabFromUrl ?? '') ? tabFromUrl! : 'episode'
  const setActiveTab = useCallback((tab: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (tab === 'episode') {
      params.delete('tab')
    } else {
      params.set('tab', tab)
    }
    const qs = params.toString()
    router.replace(`/admin/audio${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [searchParams, router])

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

  // Mixing state
  const [mixing, setMixing] = useState<MixingSettings>({ ...DEFAULT_MIXING })
  const [mixingSaving, setMixingSaving] = useState(false)
  const [mixingSuccess, setMixingSuccess] = useState(false)

  // Personality state (per locale)
  const [personalityMap, setPersonalityMap] = useState<Record<string, PersonalityState>>({})
  const [personalityLocale, setPersonalityLocale] = useState<string>('en')
  const [personalityLoading, setPersonalityLoading] = useState(false)
  const personality = personalityMap[personalityLocale] ?? null

  // Audio files state
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([])

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
    fetchAudioFiles()
  }, [])

  // Fetch personality when Character tab becomes active
  useEffect(() => {
    if (activeTab === 'character' && Object.keys(personalityMap).length === 0 && !personalityLoading) {
      fetchPersonality()
    }
  }, [activeTab])

  const fetchPersonality = useCallback(async () => {
    setPersonalityLoading(true)
    try {
      const res = await fetch('/api/admin/podcast-personality?locale=all')
      if (res.ok) {
        const data = await res.json()
        const map: Record<string, PersonalityState> = {}
        for (const p of (data.personalities || [])) {
          map[p.locale] = p
        }
        setPersonalityMap(map)
        // Auto-select first locale with data
        const locales = Object.keys(map)
        if (locales.length > 0 && !map[personalityLocale]) {
          setPersonalityLocale(locales[0])
        }
      }
    } catch (err) {
      console.error('Error fetching personality:', err)
    } finally {
      setPersonalityLoading(false)
    }
  }, [personalityLocale])

  const updateRelationship = useCallback(async (updates: Record<string, unknown>) => {
    if (!personality) return
    // Optimistic update
    setPersonalityMap(prev => ({
      ...prev,
      [personalityLocale]: { ...prev[personalityLocale], ...updates },
    }))
    try {
      const res = await fetch('/api/admin/podcast-personality', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: personalityLocale, updates }),
      })
      if (res.ok) {
        const data = await res.json()
        setPersonalityMap(prev => ({ ...prev, [personalityLocale]: data.personality }))
      } else {
        fetchPersonality() // Revert on error
      }
    } catch {
      fetchPersonality() // Revert on error
    }
  }, [personality, personalityLocale, fetchPersonality])

  async function fetchAudioFiles() {
    try {
      const res = await fetch('/api/admin/audio-files')
      if (res.ok) {
        const data = await res.json()
        setAudioFiles(data.files || [])
      }
    } catch (error) {
      console.error('Error fetching audio files:', error)
    }
  }

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
        if (data.mixing_settings) {
          setMixing({ ...DEFAULT_MIXING, ...data.mixing_settings })
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

  function updateMixing(key: keyof MixingSettings, value: number | boolean | string | AudioEnvelope) {
    setMixing(prev => ({ ...prev, [key]: value }))
  }

  async function saveMixingSettings() {
    setMixingSaving(true)
    setMixingSuccess(false)
    try {
      const res = await fetch('/api/admin/tts-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ttsSettings,
          mixing_settings: JSON.stringify(mixing),
        }),
      })
      if (res.ok) {
        setMixingSuccess(true)
        setTimeout(() => setMixingSuccess(false), 3000)
      }
    } catch (error) {
      console.error('Error saving mixing settings:', error)
    } finally {
      setMixingSaving(false)
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
        <TabsList className="grid w-full max-w-2xl grid-cols-4">
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
          <TabsTrigger value="timemachine" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Time Machine
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
                      <span className="text-muted-foreground">
                        {podcastProgress >= 90 && podcastCurrentLine >= podcastTotalLines
                          ? 'Audio zusammenführen...'
                          : `Zeile ${podcastCurrentLine} / ${podcastTotalLines}`
                        }
                      </span>
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
          {/* Audio Mixer */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <SlidersHorizontal className="h-5 w-5" />
                    Audio Mixer
                  </CardTitle>
                  <CardDescription>
                    Intro, Dialog und Outro — Lautstärke, Timing und Stereo-Positionierung
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setMixing({ ...DEFAULT_MIXING })}>
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Reset
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-8">
              {/* Intro Channel */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 rounded-full bg-emerald-500" />
                    <div>
                      <h3 className="font-semibold text-sm">INTRO</h3>
                      <p className="text-xs text-muted-foreground">Jingle vor dem Dialog</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="intro-enabled" className="text-xs text-muted-foreground">Aktiv</Label>
                    <Switch id="intro-enabled" checked={mixing.intro_enabled} onCheckedChange={(v) => updateMixing('intro_enabled', v)} />
                  </div>
                </div>

                {mixing.intro_enabled && (
                  <>
                    {/* Audio File Library */}
                    <AudioFileManager
                      type="intro"
                      files={audioFiles.filter(f => f.type === 'intro')}
                      onRefresh={fetchAudioFiles}
                    />

                    {/* Intro Envelope Editor */}
                    <div className="px-2 space-y-0">
                      <EnvelopeEditor
                        envelope={mixing.intro_music_envelope ?? legacyIntroToEnvelopes(mixing).music}
                        onChange={(env) => updateMixing('intro_music_envelope' as keyof MixingSettings, env as unknown as number)}
                        timeRange={mixing.intro_full_sec + mixing.intro_bed_sec + mixing.intro_fadeout_sec}
                        color="#10b981"
                        label="Intro"
                        height={40}
                      />
                      <EnvelopeEditor
                        envelope={mixing.intro_dialog_envelope ?? legacyIntroToEnvelopes(mixing).dialog}
                        onChange={(env) => updateMixing('intro_dialog_envelope' as keyof MixingSettings, env as unknown as number)}
                        timeRange={mixing.intro_full_sec + mixing.intro_bed_sec + mixing.intro_fadeout_sec}
                        color="#3b82f6"
                        label="Dialog"
                        height={40}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <MixerSlider label="Intro voll" value={mixing.intro_full_sec} min={0} max={10} step={0.5} unit="s"
                        onChange={(v) => updateMixing('intro_full_sec', v)} />
                      <MixerSlider label="Bed-Dauer" value={mixing.intro_bed_sec} min={0} max={20} step={0.5} unit="s"
                        onChange={(v) => updateMixing('intro_bed_sec', v)} />
                      <MixerSlider label="Bed-Volume" value={mixing.intro_bed_volume} min={0} max={50} step={1} unit="%"
                        onChange={(v) => updateMixing('intro_bed_volume', v)} />
                      <MixerSlider label="Fadeout" value={mixing.intro_fadeout_sec} min={0} max={10} step={0.5} unit="s"
                        onChange={(v) => updateMixing('intro_fadeout_sec', v)} />
                      <MixerSlider label="Dialog Fade-In" value={mixing.intro_dialog_fadein_sec} min={0} max={5} step={0.1} unit="s"
                        onChange={(v) => updateMixing('intro_dialog_fadein_sec', v)} />
                    </div>
                  </>
                )}
              </div>

              <div className="border-t" />

              {/* Dialog Channel */}
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-1 h-8 rounded-full bg-blue-500" />
                  <div>
                    <h3 className="font-semibold text-sm">DIALOG</h3>
                    <p className="text-xs text-muted-foreground">Stereo-Positionierung und Sprecherwechsel-Overlaps</p>
                  </div>
                </div>

                {/* Stereo Visualization */}
                <div className="p-4 bg-muted/30 rounded-lg border space-y-3">
                  <Label className="text-xs font-medium">Stereo-Positionierung</Label>
                  <StereoSlider label="HOST" value={mixing.stereo_host} color="#f59e0b"
                    onChange={(v) => updateMixing('stereo_host', v)} />
                  <StereoSlider label="GUEST" value={mixing.stereo_guest} color="#06b6d4"
                    onChange={(v) => updateMixing('stereo_guest', v)} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <MixerSlider label="Kurze Reaktion" value={mixing.overlap_reaction_ms} min={0} max={500} step={10} unit="ms"
                    description="Ja!, Genau!, Mhm..."
                    onChange={(v) => updateMixing('overlap_reaction_ms', v)} />
                  <MixerSlider label="Unterbrechung" value={mixing.overlap_interrupt_ms} min={0} max={500} step={10} unit="ms"
                    description="[interrupting] Tag"
                    onChange={(v) => updateMixing('overlap_interrupt_ms', v)} />
                  <MixerSlider label="Nach Frage" value={mixing.overlap_question_ms} min={0} max={500} step={10} unit="ms"
                    description="Schnelle Antwort nach ?"
                    onChange={(v) => updateMixing('overlap_question_ms', v)} />
                  <MixerSlider label="Sprecherwechsel" value={mixing.overlap_speaker_ms} min={0} max={500} step={10} unit="ms"
                    description="Normaler Wechsel"
                    onChange={(v) => updateMixing('overlap_speaker_ms', v)} />
                </div>
              </div>

              <div className="border-t" />

              {/* Outro Channel */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 rounded-full bg-purple-500" />
                    <div>
                      <h3 className="font-semibold text-sm">OUTRO</h3>
                      <p className="text-xs text-muted-foreground">Jingle nach dem Dialog</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="outro-enabled" className="text-xs text-muted-foreground">Aktiv</Label>
                    <Switch id="outro-enabled" checked={mixing.outro_enabled} onCheckedChange={(v) => updateMixing('outro_enabled', v)} />
                  </div>
                </div>

                {mixing.outro_enabled && (
                  <>
                    {/* Audio File Library */}
                    <AudioFileManager
                      type="outro"
                      files={audioFiles.filter(f => f.type === 'outro')}
                      onRefresh={fetchAudioFiles}
                    />

                    {/* Outro Envelope Editor */}
                    <div className="px-2 space-y-0">
                      <EnvelopeEditor
                        envelope={mixing.outro_music_envelope ?? legacyOutroToEnvelopes(mixing).music}
                        onChange={(env) => updateMixing('outro_music_envelope' as keyof MixingSettings, env as unknown as number)}
                        timeRange={mixing.outro_crossfade_sec}
                        color="#a855f7"
                        label="Outro"
                        height={40}
                      />
                      <EnvelopeEditor
                        envelope={mixing.outro_dialog_envelope ?? legacyOutroToEnvelopes(mixing).dialog}
                        onChange={(env) => updateMixing('outro_dialog_envelope' as keyof MixingSettings, env as unknown as number)}
                        timeRange={mixing.outro_crossfade_sec}
                        color="#3b82f6"
                        label="Dialog"
                        height={40}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <MixerSlider label="Crossfade gesamt" value={mixing.outro_crossfade_sec} min={3} max={20} step={0.5} unit="s"
                        onChange={(v) => updateMixing('outro_crossfade_sec', v)} />
                      <MixerSlider label="Anstieg" value={mixing.outro_rise_sec} min={0} max={10} step={0.5} unit="s"
                        description="Outro-Musik blendet ein"
                        onChange={(v) => updateMixing('outro_rise_sec', v)} />
                      <MixerSlider label="Bed-Volume" value={mixing.outro_bed_volume} min={0} max={50} step={1} unit="%"
                        onChange={(v) => updateMixing('outro_bed_volume', v)} />
                      <MixerSlider label="Finale ab" value={mixing.outro_final_start_sec} min={1} max={15} step={0.5} unit="s"
                        description="Crossfade auf 100%"
                        onChange={(v) => updateMixing('outro_final_start_sec', v)} />
                    </div>
                  </>
                )}
              </div>

              {/* Save Button */}
              <div className="flex items-center gap-4 pt-2 border-t">
                <Button onClick={saveMixingSettings} disabled={mixingSaving}>
                  {mixingSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Mixer speichern
                </Button>
                {mixingSuccess && (
                  <span className="text-sm text-green-600 flex items-center gap-1">
                    <CheckCircle className="h-4 w-4" />
                    Gespeichert
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* TTS Voice Settings */}
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
                        max={35}
                        step={1}
                        className="w-full max-w-md"
                      />
                      <div className="flex items-center justify-between max-w-md">
                        <span className="text-sm text-muted-foreground">5 Min</span>
                        <Badge variant="secondary" className="text-sm">{podcastDuration} Minuten</Badge>
                        <span className="text-sm text-muted-foreground">35 Min</span>
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
                  {/* Locale Switcher + Status Bar */}
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1 mr-2">
                      {PODCAST_LOCALES.map((loc) => {
                        const hasData = !!personalityMap[loc.code]
                        return (
                          <Button
                            key={loc.code}
                            variant={personalityLocale === loc.code ? 'default' : 'outline'}
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            onClick={() => setPersonalityLocale(loc.code)}
                          >
                            {loc.code.toUpperCase()}
                            {hasData && <span className="ml-1 text-[9px] opacity-60">({personalityMap[loc.code].episode_count})</span>}
                          </Button>
                        )
                      })}
                    </div>
                    <Badge variant="default" className="text-sm">
                      Episode #{personality ? personality.episode_count : 0}
                    </Badge>
                    {personality?.host_name && (
                      <Badge variant="outline" className="text-sm border-blue-500/50 text-blue-600">
                        Host: {personality.host_name}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-sm">
                      {PHASE_LABELS[personality?.relationship_phase || 'strangers']}
                    </Badge>
                    {personality?.current_mood && (() => {
                      const moodConfig: Record<string, { label: string; className: string }> = {
                        euphoric: { label: 'Euphorisch', className: 'border-yellow-400 text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30' },
                        optimistic: { label: 'Optimistisch', className: 'border-green-400 text-green-600 bg-green-50 dark:bg-green-950/30' },
                        neutral: { label: 'Neutral', className: 'border-gray-400 text-gray-600 bg-gray-50 dark:bg-gray-800/30' },
                        negative: { label: 'Negativ', className: 'border-red-400 text-red-600 bg-red-50 dark:bg-red-950/30' },
                      }
                      const cfg = moodConfig[personality.current_mood] || moodConfig.optimistic
                      return (
                        <Badge variant="outline" className={`text-sm ${cfg.className}`}>
                          Mood: {cfg.label}
                        </Badge>
                      )
                    })()}
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
                    <div className={`space-y-2 p-4 rounded-lg border ${personality?.relationship_paused ? 'opacity-50' : ''}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Label className="text-sm font-medium">Komfort-Level</Label>
                          {personality?.relationship_paused && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-300">pausiert</Badge>
                          )}
                        </div>
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
                    <div className={`space-y-2 p-4 rounded-lg border ${personality?.relationship_paused ? 'opacity-50' : ''}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Label className="text-sm font-medium">Flirt-Tendenz</Label>
                          {personality?.relationship_paused && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-300">pausiert</Badge>
                          )}
                        </div>
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

                    {/* Self-Irony Meter */}
                    <div className="space-y-2 p-4 rounded-lg border">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Selbstironie</Label>
                        <span className="text-sm font-mono text-muted-foreground">
                          {Math.round((personality?.self_irony ?? 0.5) * 100)}%
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-violet-400 transition-all duration-500"
                          style={{ width: `${(personality?.self_irony ?? 0.5) * 100}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Wie stark sich die beiden über sich selbst und ihre KI-Natur lustig machen
                      </p>
                    </div>

                    {/* Relationship Controls */}
                    <div className="space-y-3 p-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
                      <Label className="text-sm font-semibold">Beziehungssteuerung</Label>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor="pause-toggle" className="text-sm">Beziehung pausieren</Label>
                          <p className="text-xs text-muted-foreground">Friert Komfort + Flirt ein</p>
                        </div>
                        <Switch
                          id="pause-toggle"
                          checked={personality?.relationship_paused ?? false}
                          onCheckedChange={(checked) => {
                            updateRelationship({ relationship_paused: checked })
                          }}
                          disabled={!personality}
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700"
                        disabled={!personality}
                        onClick={() => {
                          if (!personality) return
                          const newComfort = Math.max(0, Math.round((personality.mutual_comfort - 0.1) * 1000) / 1000)
                          const newFlirt = Math.max(0, Math.round((personality.flirtation_tendency - 0.05) * 1000) / 1000)
                          if (window.confirm(`Cooldown: Komfort ${Math.round(personality.mutual_comfort * 100)}% → ${Math.round(newComfort * 100)}%, Flirt ${Math.round(personality.flirtation_tendency * 100)}% → ${Math.round(newFlirt * 100)}%`)) {
                            updateRelationship({ mutual_comfort: newComfort, flirtation_tendency: newFlirt })
                          }
                        }}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Cooldown (-10% / -5%)
                      </Button>
                      <div className="space-y-1 pt-2 border-t border-amber-200 dark:border-amber-800">
                        <Label className="text-sm">Nächste Episode Mood</Label>
                        <Select
                          value={personality?.current_mood || 'optimistic'}
                          onValueChange={(value) => updateRelationship({ current_mood: value })}
                          disabled={!personality}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="euphoric">Euphorisch</SelectItem>
                            <SelectItem value="optimistic">Optimistisch</SelectItem>
                            <SelectItem value="neutral">Neutral</SelectItem>
                            <SelectItem value="negative">Negativ</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">Wird nach jeder Episode automatisch neu gewürfelt</p>
                      </div>
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
                        {personality.memorable_moments.map((m, i) => {
                          const typeStyle = MOMENT_TYPE_STYLES[m.type ?? 'ai_reflection'] || DEFAULT_MOMENT_STYLE
                          return (
                            <div key={i} className="flex items-start gap-2 text-sm">
                              <Badge variant="outline" className="text-xs shrink-0 mt-0.5">#{m.episode}</Badge>
                              <Badge className={`text-xs shrink-0 mt-0.5 border-0 ${typeStyle.color}`}>{typeStyle.label}</Badge>
                              <span className="text-muted-foreground italic">&ldquo;{m.text}&rdquo;</span>
                            </div>
                          )
                        })}
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

          {/* Pipeline Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" />
                Personality-Pipeline
              </CardTitle>
              <CardDescription>
                Datenfluss pro Episode: Wie die Persönlichkeiten ins Script gelangen und sich weiterentwickeln
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PersonalityPipeline personality={personality} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================ */}
        {/* TIME MACHINE TAB                                                 */}
        {/* ================================================================ */}
        <TabsContent value="timemachine" className="space-y-6">
          <PodcastTimeMachine />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small Dimension Bar Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mixer Components
// ---------------------------------------------------------------------------

function MixerSlider({ label, value, min, max, step, unit, description, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  description?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-medium">{label}</span>
          {description && <p className="text-[10px] text-muted-foreground">{description}</p>}
        </div>
        <span className="text-xs font-mono tabular-nums text-muted-foreground">{value}{unit}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} className="w-full" />
    </div>
  )
}

function StereoSlider({ label, value, color, onChange }: {
  label: string
  value: number
  color: string
  onChange: (v: number) => void
}) {
  const leftPct = 100 - value
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">L {leftPct}%</span>
        <span className="font-medium" style={{ color }}>{label}</span>
        <span className="text-muted-foreground">R {value}%</span>
      </div>
      <div className="relative">
        <Slider value={[value]} min={0} max={100} step={1} onValueChange={(v) => onChange(v[0])} className="w-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-3 bg-muted-foreground/30 pointer-events-none" />
      </div>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Personality Helpers
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
