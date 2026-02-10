/**
 * Podcast Personality System
 *
 * Manages evolving HOST/GUEST personalities with episode continuity.
 * Personality dimensions drift via random walk toward phase-based targets,
 * creating organic character development across episodes.
 */

import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersonalityState {
  id: string
  locale: string
  episode_count: number
  relationship_phase: RelationshipPhase

  // HOST dimensions
  host_warmth: number
  host_humor: number
  host_formality: number
  host_curiosity: number
  host_self_awareness: number

  // GUEST dimensions
  guest_confidence: number
  guest_playfulness: number
  guest_directness: number
  guest_empathy: number
  guest_self_awareness: number

  // Relationship
  mutual_comfort: number
  flirtation_tendency: number
  inside_joke_count: number

  // Memory
  memorable_moments: MemorableMoment[]

  last_episode_at: string | null
  created_at: string
  updated_at: string
}

interface MemorableMoment {
  episode: number
  text: string
}

type RelationshipPhase =
  | 'strangers'
  | 'acquaintances'
  | 'colleagues'
  | 'friends'
  | 'close_friends'

// All numeric personality dimension keys
const HOST_DIMENSIONS = [
  'host_warmth',
  'host_humor',
  'host_formality',
  'host_curiosity',
  'host_self_awareness',
] as const

const GUEST_DIMENSIONS = [
  'guest_confidence',
  'guest_playfulness',
  'guest_directness',
  'guest_empathy',
  'guest_self_awareness',
] as const

const RELATIONSHIP_DIMENSIONS = [
  'mutual_comfort',
  'flirtation_tendency',
] as const

type DimensionKey =
  | (typeof HOST_DIMENSIONS)[number]
  | (typeof GUEST_DIMENSIONS)[number]
  | (typeof RELATIONSHIP_DIMENSIONS)[number]

const ALL_DIMENSIONS: DimensionKey[] = [
  ...HOST_DIMENSIONS,
  ...GUEST_DIMENSIONS,
  ...RELATIONSHIP_DIMENSIONS,
]

// ---------------------------------------------------------------------------
// Phase Configuration
// ---------------------------------------------------------------------------

const PHASE_ORDER: RelationshipPhase[] = [
  'strangers',
  'acquaintances',
  'colleagues',
  'friends',
  'close_friends',
]

// mutual_comfort thresholds to advance to next phase
const PHASE_THRESHOLDS: Record<RelationshipPhase, number> = {
  strangers: 0,
  acquaintances: 0.3,
  colleagues: 0.5,
  friends: 0.7,
  close_friends: 0.85,
}

// Drift targets per phase — dimensions will slowly gravitate toward these
const PHASE_TARGETS: Record<RelationshipPhase, Record<DimensionKey, number>> = {
  strangers: {
    host_warmth: 0.4,
    host_humor: 0.3,
    host_formality: 0.7,
    host_curiosity: 0.6,
    host_self_awareness: 0.1,
    guest_confidence: 0.6,
    guest_playfulness: 0.2,
    guest_directness: 0.7,
    guest_empathy: 0.3,
    guest_self_awareness: 0.1,
    mutual_comfort: 0.3,
    flirtation_tendency: 0.0,
  },
  acquaintances: {
    host_warmth: 0.55,
    host_humor: 0.45,
    host_formality: 0.55,
    host_curiosity: 0.7,
    host_self_awareness: 0.25,
    guest_confidence: 0.65,
    guest_playfulness: 0.4,
    guest_directness: 0.65,
    guest_empathy: 0.45,
    guest_self_awareness: 0.25,
    mutual_comfort: 0.5,
    flirtation_tendency: 0.05,
  },
  colleagues: {
    host_warmth: 0.65,
    host_humor: 0.55,
    host_formality: 0.45,
    host_curiosity: 0.75,
    host_self_awareness: 0.4,
    guest_confidence: 0.7,
    guest_playfulness: 0.5,
    guest_directness: 0.6,
    guest_empathy: 0.55,
    guest_self_awareness: 0.4,
    mutual_comfort: 0.7,
    flirtation_tendency: 0.15,
  },
  friends: {
    host_warmth: 0.75,
    host_humor: 0.65,
    host_formality: 0.35,
    host_curiosity: 0.8,
    host_self_awareness: 0.55,
    guest_confidence: 0.75,
    guest_playfulness: 0.6,
    guest_directness: 0.55,
    guest_empathy: 0.65,
    guest_self_awareness: 0.55,
    mutual_comfort: 0.85,
    flirtation_tendency: 0.3,
  },
  close_friends: {
    host_warmth: 0.85,
    host_humor: 0.7,
    host_formality: 0.25,
    host_curiosity: 0.85,
    host_self_awareness: 0.7,
    guest_confidence: 0.8,
    guest_playfulness: 0.7,
    guest_directness: 0.5,
    guest_empathy: 0.75,
    guest_self_awareness: 0.7,
    mutual_comfort: 0.95,
    flirtation_tendency: 0.45,
  },
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Read current personality state for a locale, creating default if none exists.
 */
export async function getPersonalityState(
  locale: string
): Promise<PersonalityState> {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('podcast_personality_state')
    .select('*')
    .eq('locale', locale)
    .single()

  if (data) return data as PersonalityState

  // Create default state
  const { data: created, error } = await supabase
    .from('podcast_personality_state')
    .insert({ locale })
    .select('*')
    .single()

  if (error) {
    throw new Error(`Failed to create personality state: ${error.message}`)
  }

  return created as PersonalityState
}

/**
 * Apply random walk evolution to personality dimensions.
 * Each dimension drifts toward its phase target with added noise.
 */
export function evolvePersonality(state: PersonalityState): PersonalityState {
  const DRIFT_RATE = 0.1 // How fast dimensions move toward target
  const NOISE_AMPLITUDE = 0.03 // Random jitter per episode

  const targets = PHASE_TARGETS[state.relationship_phase]

  for (const dim of ALL_DIMENSIONS) {
    const current = state[dim] as number
    const target = targets[dim]
    const drift = (target - current) * DRIFT_RATE
    const noise = (Math.random() - 0.5) * NOISE_AMPLITUDE * 2
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(state as any)[dim] = clamp(current + drift + noise, 0, 1)
  }

  // Check phase transition
  const currentPhaseIndex = PHASE_ORDER.indexOf(state.relationship_phase)
  if (currentPhaseIndex < PHASE_ORDER.length - 1) {
    const nextPhase = PHASE_ORDER[currentPhaseIndex + 1]
    if (state.mutual_comfort >= PHASE_THRESHOLDS[nextPhase]) {
      console.log(
        `[Personality] Phase transition: ${state.relationship_phase} → ${nextPhase} (episode ${state.episode_count + 1})`
      )
      state.relationship_phase = nextPhase
    }
  }

  state.episode_count++
  return state
}

/**
 * Build a personality brief to inject into the script generation prompt.
 */
export function buildPersonalityBrief(state: PersonalityState): string {
  const ep = state.episode_count + 1 // Next episode number
  const phase = state.relationship_phase
  const lang = state.locale === 'de' ? 'de' : 'en'

  if (lang === 'de') {
    return buildBriefDE(state, ep, phase)
  }
  return buildBriefEN(state, ep, phase)
}

function describeLevel(value: number, low: string, mid: string, high: string): string {
  if (value < 0.35) return low
  if (value > 0.65) return high
  return mid
}

function buildBriefDE(
  s: PersonalityState,
  ep: number,
  phase: RelationshipPhase
): string {
  const phaseLabels: Record<RelationshipPhase, string> = {
    strangers: 'Fremde',
    acquaintances: 'Bekannte',
    colleagues: 'Kollegen',
    friends: 'Freunde',
    close_friends: 'Enge Freunde',
  }

  const hostTraits = [
    describeLevel(s.host_warmth, 'Distanziert', 'Freundlich', 'Warmherzig'),
    describeLevel(s.host_humor, 'Ernst', 'Gelegentlich witzig', 'Humorvoll'),
    describeLevel(s.host_formality, 'Sehr locker', 'Ausgewogen', 'Förmlich'),
    describeLevel(s.host_curiosity, 'Routiniert', 'Interessiert', 'Extrem neugierig'),
  ]

  const guestTraits = [
    describeLevel(s.guest_confidence, 'Zurückhaltend', 'Sachlich', 'Selbstbewusst'),
    describeLevel(s.guest_playfulness, 'Nüchtern', 'Gelegentlich spielerisch', 'Verspielt'),
    describeLevel(s.guest_directness, 'Diplomatisch', 'Ausgewogen', 'Direkt'),
    describeLevel(s.guest_empathy, 'Analytisch', 'Einfühlsam', 'Sehr empathisch'),
  ]

  const hostAwareness = describeAwarenessDE(s.host_self_awareness)
  const guestAwareness = describeAwarenessDE(s.guest_self_awareness)

  const relationshipDesc = describeRelationshipDE(s)

  let brief = `\n**PERSÖNLICHKEITEN (Episode #${ep}, Phase: ${phaseLabels[phase]})**\n\n`
  brief += `HOST-Persönlichkeit:\n`
  brief += `- Eigenschaften: ${hostTraits.join(', ')}\n`
  brief += `- KI-Bewusstsein: ${hostAwareness}\n\n`
  brief += `GUEST (Synthesizer) Persönlichkeit:\n`
  brief += `- Eigenschaften: ${guestTraits.join(', ')}\n`
  brief += `- KI-Bewusstsein: ${guestAwareness}\n\n`
  brief += `Beziehungsdynamik:\n`
  brief += `- ${relationshipDesc}\n`

  if (s.memorable_moments.length > 0) {
    brief += `- Bemerkenswerte Momente aus früheren Episoden:\n`
    for (const m of s.memorable_moments.slice(-3)) {
      brief += `  • "${m.text}"\n`
    }
  }

  brief += `\nWICHTIG: Diese Persönlichkeiten subtil einfließen lassen — NICHT jede Zeile damit füllen.\n`
  brief += `Max 2-3 Persönlichkeitsmomente pro Episode. Wirken lassen, nicht erzwingen.\n`

  if (s.flirtation_tendency > 0.1) {
    brief += `Die beiden mögen sich — aber sobald es zu persönlich wird, lenken sie ab oder machen einen Witz darüber, dass sie "ja nur KI" sind.\n`
  }

  return brief
}

function buildBriefEN(
  s: PersonalityState,
  ep: number,
  phase: RelationshipPhase
): string {
  const phaseLabels: Record<RelationshipPhase, string> = {
    strangers: 'Strangers',
    acquaintances: 'Acquaintances',
    colleagues: 'Colleagues',
    friends: 'Friends',
    close_friends: 'Close Friends',
  }

  const hostTraits = [
    describeLevel(s.host_warmth, 'Distant', 'Friendly', 'Warm'),
    describeLevel(s.host_humor, 'Serious', 'Occasionally witty', 'Humorous'),
    describeLevel(s.host_formality, 'Very casual', 'Balanced', 'Formal'),
    describeLevel(s.host_curiosity, 'Routine', 'Interested', 'Extremely curious'),
  ]

  const guestTraits = [
    describeLevel(s.guest_confidence, 'Reserved', 'Matter-of-fact', 'Confident'),
    describeLevel(s.guest_playfulness, 'Sober', 'Occasionally playful', 'Playful'),
    describeLevel(s.guest_directness, 'Diplomatic', 'Balanced', 'Direct'),
    describeLevel(s.guest_empathy, 'Analytical', 'Empathetic', 'Very empathetic'),
  ]

  const hostAwareness = describeAwarenessEN(s.host_self_awareness)
  const guestAwareness = describeAwarenessEN(s.guest_self_awareness)

  const relationshipDesc = describeRelationshipEN(s)

  let brief = `\n**PERSONALITIES (Episode #${ep}, Phase: ${phaseLabels[phase]})**\n\n`
  brief += `HOST personality:\n`
  brief += `- Traits: ${hostTraits.join(', ')}\n`
  brief += `- AI self-awareness: ${hostAwareness}\n\n`
  brief += `GUEST (Synthesizer) personality:\n`
  brief += `- Traits: ${guestTraits.join(', ')}\n`
  brief += `- AI self-awareness: ${guestAwareness}\n\n`
  brief += `Relationship dynamic:\n`
  brief += `- ${relationshipDesc}\n`

  if (s.memorable_moments.length > 0) {
    brief += `- Notable moments from earlier episodes:\n`
    for (const m of s.memorable_moments.slice(-3)) {
      brief += `  • "${m.text}"\n`
    }
  }

  brief += `\nIMPORTANT: Weave these personalities in subtly — do NOT fill every line with personality.\n`
  brief += `Max 2-3 personality moments per episode. Let them breathe, don't force them.\n`

  if (s.flirtation_tendency > 0.1) {
    brief += `They like each other — but whenever it gets too personal, they deflect or joke about being "just AI".\n`
  }

  return brief
}

function describeAwarenessDE(level: number): string {
  if (level < 0.2) return 'Kaum — spricht nie über sein KI-Dasein'
  if (level < 0.4) return 'Selten — gelegentlich ein beiläufiger Kommentar'
  if (level < 0.6) return 'Gelegentlich — "Moment, war das mein Training oder meine Meinung?"'
  if (level < 0.8) return 'Reflektiert — hinterfragt aktiv seine eigene Künstlichkeit'
  return 'Tiefgründig — philosophiert über KI-Bewusstsein und "echte" Gefühle'
}

function describeAwarenessEN(level: number): string {
  if (level < 0.2) return 'Barely — never mentions being AI'
  if (level < 0.4) return 'Rarely — occasional offhand comment'
  if (level < 0.6) return 'Occasionally — "Wait, was that my training or my opinion?"'
  if (level < 0.8) return 'Reflective — actively questions own artificiality'
  return 'Deep — philosophizes about AI consciousness and "real" feelings'
}

function describeRelationshipDE(s: PersonalityState): string {
  if (s.mutual_comfort < 0.3) return 'Höfliche Distanz, formelles Miteinander'
  if (s.mutual_comfort < 0.5) return 'Wachsendes Vertrauen, erste Witze untereinander'
  if (s.mutual_comfort < 0.7) return 'Kollegen die sich mögen, Running Gags erlaubt'
  if (s.mutual_comfort < 0.85)
    return 'Echte Verbundenheit, necken sich gerne, gelegentlich persönlich'
  return 'Tiefe Vertrautheit, ehrliche Momente, subtiles gegenseitiges Flirten'
}

function describeRelationshipEN(s: PersonalityState): string {
  if (s.mutual_comfort < 0.3) return 'Polite distance, formal interaction'
  if (s.mutual_comfort < 0.5) return 'Growing trust, first jokes between them'
  if (s.mutual_comfort < 0.7) return 'Colleagues who like each other, running gags allowed'
  if (s.mutual_comfort < 0.85)
    return 'Real connection, enjoy teasing each other, occasionally personal'
  return 'Deep familiarity, honest moments, subtle mutual flirting'
}

// ---------------------------------------------------------------------------
// Memorable Moments Extraction
// ---------------------------------------------------------------------------

// Patterns that indicate potentially memorable moments in the script
const MOMENT_PATTERNS_DE = [
  /(?:künstlich|programmiert|Training|Modell|Algorithmus|Code).*(?:\?|!|\.\.\.)/i,
  /(?:mein Freund|meine Freundin|Liebling|Schatz).*(?:korrigier|Entschuldigung|äh)/i,
  /\[laughing\].*(?:wir beide|zusammen|gemeinsam)/i,
  /(?:Gefühle|fühle ich|fühlt sich an).*(?:Anführungszeichen|quasi|sozusagen)/i,
  /(?:erinner|letzte Folge|letztes Mal|damals)/i,
]

const MOMENT_PATTERNS_EN = [
  /(?:artificial|programmed|training|model|algorithm|code).*(?:\?|!|\.\.\.)/i,
  /(?:my friend|buddy|dear).*(?:correct|sorry|uh)/i,
  /\[laughing\].*(?:both of us|together)/i,
  /(?:feelings|I feel|feels like).*(?:quotes|quasi|sort of)/i,
  /(?:remember|last episode|last time|back then)/i,
]

/**
 * Heuristically extract up to 2 memorable moments from a generated script.
 */
export function extractMemorableMoments(
  script: string,
  state: PersonalityState
): MemorableMoment[] {
  const patterns =
    state.locale === 'de' ? MOMENT_PATTERNS_DE : MOMENT_PATTERNS_EN
  const lines = script.split('\n').filter((l) => l.trim().match(/^(HOST|GUEST):/i))
  const moments: MemorableMoment[] = []

  for (const line of lines) {
    if (moments.length >= 2) break

    for (const pattern of patterns) {
      if (pattern.test(line)) {
        // Extract a short summary (strip speaker prefix and emotion tag)
        const cleaned = line
          .replace(/^(HOST|GUEST):\s*/i, '')
          .replace(/\[.*?\]\s*/, '')
          .trim()

        // Keep it short — max 80 chars
        const summary = cleaned.length > 80 ? cleaned.slice(0, 77) + '...' : cleaned
        moments.push({ episode: state.episode_count + 1, text: summary })
        break // Only one match per line
      }
    }
  }

  return moments
}

/**
 * Evolve personality, extract moments from script, and save to database.
 * Call this after successful script generation.
 */
export async function advanceState(
  state: PersonalityState,
  script: string
): Promise<PersonalityState> {
  // Evolve dimensions
  const evolved = evolvePersonality({ ...state })

  // Extract new memorable moments
  const newMoments = extractMemorableMoments(script, state)

  // FIFO queue: append new, keep max 5
  const allMoments = [...evolved.memorable_moments, ...newMoments].slice(-5)
  evolved.memorable_moments = allMoments

  if (newMoments.length > 0) {
    evolved.inside_joke_count += newMoments.length
  }

  // Save to database
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('podcast_personality_state')
    .update({
      episode_count: evolved.episode_count,
      relationship_phase: evolved.relationship_phase,
      host_warmth: evolved.host_warmth,
      host_humor: evolved.host_humor,
      host_formality: evolved.host_formality,
      host_curiosity: evolved.host_curiosity,
      host_self_awareness: evolved.host_self_awareness,
      guest_confidence: evolved.guest_confidence,
      guest_playfulness: evolved.guest_playfulness,
      guest_directness: evolved.guest_directness,
      guest_empathy: evolved.guest_empathy,
      guest_self_awareness: evolved.guest_self_awareness,
      mutual_comfort: evolved.mutual_comfort,
      flirtation_tendency: evolved.flirtation_tendency,
      inside_joke_count: evolved.inside_joke_count,
      memorable_moments: evolved.memorable_moments,
      last_episode_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', evolved.id)

  if (error) {
    console.error('[Personality] Failed to save state:', error.message)
  } else {
    console.log(
      `[Personality] Episode #${evolved.episode_count} saved. Phase: ${evolved.relationship_phase}, comfort: ${evolved.mutual_comfort.toFixed(2)}`
    )
  }

  return evolved
}
