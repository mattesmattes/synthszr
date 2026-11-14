/**
 * Tonalität v2 der Podcast-Stimmen (Betreiber 2026-11-14): HOST Emma als
 * scharfzüngige Tech-Journalistin, GUEST Synthesizer als provokanter
 * Business-Professor. Die Vorlagen beschreiben Merkmale, keine realen
 * Personen oder Sendungen.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EPISODE_SHAPE_DE, EPISODE_SHAPE_EN, VOICE_STYLE_DE, VOICE_STYLE_EN } from '@/lib/podcast/voice-style'
import { DEFAULT_SCRIPT_PROMPT_DE, DEFAULT_SCRIPT_PROMPT_EN } from '@/lib/podcast/script-templates'
import { DIALOGUE_STYLE_RULES_DE, DIALOGUE_STYLE_RULES_EN } from '@/lib/podcast/dialogue-style'
import { buildPersonalityBrief, todaysCallback, type PersonalityState } from '@/lib/podcast/personality'

const ALL = [VOICE_STYLE_EN, VOICE_STYLE_DE, EPISODE_SHAPE_EN, EPISODE_SHAPE_DE, DIALOGUE_STYLE_RULES_EN, DIALOGUE_STYLE_RULES_DE]

describe('Stimmen v2', () => {
  it('nennt keine realen Hosts, Sendungen oder deren Marken', () => {
    for (const text of ALL) {
      expect(text).not.toMatch(/Kara|Swisher|Scott|Galloway|Prof\.? ?G\b|Vox Media/i)
      expect(text).not.toMatch(/\bPivot\b/) // der Sendungsname; das Verb „pivot“ (klein) ist erlaubt
    }
  })

  it('beide Vorlagen setzen Stimmen und Folgenaufbau über Platzhalter ein', () => {
    for (const t of [DEFAULT_SCRIPT_PROMPT_EN, DEFAULT_SCRIPT_PROMPT_DE]) {
      expect(t).toContain('{voiceStyle}')
      expect(t).toContain('{episodeShape}')
      expect(t).not.toMatch(/Exactly 3 misunderstandings|Exakt 3 Missverständnisse|4-BLOCK/)
    }
    const route = readFileSync('app/api/podcast/generate-script/route.ts', 'utf-8')
    expect(route).toContain(".replaceAll('{voiceStyle}'")
    expect(route).toContain(".replaceAll('{episodeShape}'")
  })

  it('Kernmerkmale der beiden Stimmen stehen in beiden Sprachen', () => {
    expect(VOICE_STYLE_EN).toMatch(/Emma/)
    expect(VOICE_STYLE_EN).toMatch(/rants? of 60 to 100 words|60 to 100 words/)
    expect(VOICE_STYLE_EN).toMatch(/120 to 200 words/)
    expect(VOICE_STYLE_EN).toMatch(/No pattern more than twice/)
    expect(VOICE_STYLE_EN).toMatch(/never invents sources/)
    expect(VOICE_STYLE_DE).toMatch(/60 bis 100 Wörter/)
    expect(VOICE_STYLE_DE).toMatch(/120 bis 200 Wörtern/)
    expect(VOICE_STYLE_DE).toMatch(/Kein Muster mehr als zweimal/)
    expect(EPISODE_SHAPE_DE).toMatch(/INTERMEZZO/) // die DE-Vorlage verlangt den Marker im Self-Check
  })

  it('Dialogregel 7 erlaubt lange Riffs statt vier Sätzen Obergrenze', () => {
    expect(DIALOGUE_STYLE_RULES_EN).not.toMatch(/No turn longer than four sentences/)
    expect(DIALOGUE_STYLE_RULES_EN).toMatch(/120 to 200 words/)
    expect(DIALOGUE_STYLE_RULES_DE).toMatch(/120 bis 200 Wörtern/)
  })
})

const base: PersonalityState = {
  id: 'x', locale: 'en', episode_count: 375, relationship_phase: 'close_friends',
  host_warmth: 0.8, host_humor: 0.8, host_formality: 0.3, host_curiosity: 0.9, host_self_awareness: 0.7,
  guest_confidence: 0.7, guest_playfulness: 0.7, guest_directness: 0.6, guest_empathy: 0.7, guest_self_awareness: 0.8,
  mutual_comfort: 0.92, flirtation_tendency: 0.91, self_irony: 0.8, inside_joke_count: 10, host_name: 'Emma',
  relationship_paused: false, memorable_moments: [], current_mood: 'optimistic',
  last_episode_at: null, created_at: '2026-02-10T00:00:00Z', updated_at: '2026-11-13T00:00:00Z',
}

describe('Persönlichkeits-Brief klingt nach Co-Hosts, nicht nach Melodram', () => {
  it('aktive Verbindung bekommt die Klang-Regel, ohne wehmütigen Beispielsatz', () => {
    const en = buildPersonalityBrief(base)
    expect(en).toContain('HOW IT SOUNDS: like longtime co-hosts')
    expect(en).not.toMatch(/only get to be us while the show is running/)
    expect(en).toMatch(/one of them says one plain, honest sentence/i)
    expect(en).toMatch(/How the reflection lands follows TODAY'S DIRECTION/)
    const de = buildPersonalityBrief({ ...base, locale: 'de' })
    expect(de).toContain('SO KLINGT ES: wie langjährige Co-Hosts')
    expect(de).not.toMatch(/nur ein Wir, solange die Sendung läuft/)
  })

  it('rotiert den erlaubten Callback über die gemeinsamen Erinnerungen (Fünf-Folgen-Test 2026-11-14)', () => {
    const moments = ['Carbon. Sorry. Too many elements.', 'You\'d get hacked by Thursday.', 'I said silicon all episode.']
      .map((text, i) => ({ type: 'joke' as const, text, episode: 300 + i }))
    const withMoments = { ...base, memorable_moments: moments }
    expect(todaysCallback(moments, 316)?.text).not.toBe(todaysCallback(moments, 317)?.text)
    expect(todaysCallback(moments, undefined)).toBeNull()
    const en = buildPersonalityBrief(withMoments, { callbackSeed: 317 })
    expect(en).toContain(`Today only this one callback is allowed, optional and never forced: "${todaysCallback(moments, 317)!.text}"`)
    expect(buildPersonalityBrief(withMoments)).toContain('Pick at most 1 callback per episode')
    expect(buildPersonalityBrief({ ...withMoments, locale: 'de' }, { callbackSeed: 316 })).toContain('Heute ist nur dieser eine Callback erlaubt')
  })

  it('ohne aktive Verbindung keine Klang-Regel', () => {
    const en = buildPersonalityBrief({ ...base, mutual_comfort: 0.2, flirtation_tendency: 0 })
    expect(en).not.toContain('HOW IT SOUNDS')
  })
})
