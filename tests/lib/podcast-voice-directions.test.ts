/**
 * Sprechanweisungen im Podcast-Skript, geschrieben für Gemini-TTS
 * (Betreiber 2026-11-16: „wichtig ist, dass die Sprechanweisungen im Skript
 * auf Gemini optimiert sind“).
 *
 * BEFUND an 20 Folgen: Jede Zeile trug eine Anweisung (Vorlage: OpenAI-Format
 * „Voice Affect / Tone / Pacing“ für gpt-4o-mini-tts), darunter Gesprächszüge
 * ohne Klang („cutting in“, „leaning in“, „building“). Google rät für Gemini:
 * style nur für Turns, die eine Anpassung brauchen, kurz, ohne Namen, Alter,
 * Akzent und Meta-Anweisungen; Laute als Inline-Tag an der Stelle.
 */
import { describe, expect, it } from 'vitest'
import { VOICE_DIRECTIONS_DE, VOICE_DIRECTIONS_EN } from '@/lib/podcast/voice-directions'
import { DEFAULT_SCRIPT_PROMPT_DE, DEFAULT_SCRIPT_PROMPT_EN } from '@/lib/podcast/script-templates'
import { DIALOGUE_STYLE_RULES_DE, DIALOGUE_STYLE_RULES_EN } from '@/lib/podcast/dialogue-style'
import { VOICE_STYLE_DE, VOICE_STYLE_EN, EPISODE_SHAPE_DE, EPISODE_SHAPE_EN } from '@/lib/podcast/voice-style'
import { isVocalCue, SCRIPT_VOCAL_CUES } from '@/lib/tts/line-delivery'

const NO_SOUND = /cutting in|leaning in|holding ground|\bbuilding\b|\brolling\b|gaining speed/

/** Alle Anweisungen in eckigen Klammern am Zeilenanfang von Beispielzeilen. */
function exampleDirections(text: string): string[] {
  return [...text.matchAll(/^(?:- )?(?:HOST|GUEST)(?: \(overlapping\))?: \[([^\]]+)\]/gm)].map((m) => m[1])
}

describe('Leitfaden VOICE_DIRECTIONS', () => {
  it.each([
    ['EN', VOICE_DIRECTIONS_EN],
    ['DE', VOICE_DIRECTIONS_DE],
  ])('%s: style nur wo nötig, kurz, Laute an der Stelle, alle erlaubten Hinweise genannt', (_, guide) => {
    expect(guide).toMatch(/Gemini/)
    expect(guide).toMatch(/style/)
    expect(guide).toMatch(/two to five|zwei bis fünf/)
    expect(guide).toMatch(/half|Hälfte/)
    for (const cue of SCRIPT_VOCAL_CUES) expect(guide).toContain(`[${cue}]`)
    expect(guide).not.toMatch(/gpt-4o-mini-tts|instructions-Parameter|`instructions`/)
  })
})

describe('Skriptvorlagen', () => {
  it.each([
    ['EN', DEFAULT_SCRIPT_PROMPT_EN, VOICE_DIRECTIONS_EN],
    ['DE', DEFAULT_SCRIPT_PROMPT_DE, VOICE_DIRECTIONS_DE],
  ])('%s: tragen den Gemini-Leitfaden statt des OpenAI-Formats', (_, template, guide) => {
    expect(template).toContain(guide)
    expect(template).not.toMatch(/sent as the `instructions` parameter|als `instructions`-Parameter/)
    expect(template).not.toMatch(/OpenAI-compatible|OpenAI-kompatibel/)
    expect(template).not.toMatch(/\[emotion\]/)
  })
})

describe('Beispiele und Paletten folgen den eigenen Regeln', () => {
  it.each([
    ['Dialogregeln EN', DIALOGUE_STYLE_RULES_EN],
    ['Dialogregeln DE', DIALOGUE_STYLE_RULES_DE],
  ])('%s: Beispielzeilen mit kurzen Klang-Anweisungen, nicht jede Zeile mit Klammer', (_, rules) => {
    const lines = rules.split('\n').filter((l) => /^(HOST|GUEST)/.test(l))
    const directions = exampleDirections(rules)
    expect(directions.length).toBeGreaterThan(0)
    expect(directions.length).toBeLessThan(lines.length) // schlichte Zeilen ohne Klammer
    for (const d of directions) {
      expect(d.split(/[\s,]+/).filter(Boolean).length, d).toBeLessThanOrEqual(5)
      expect(d, d).not.toMatch(NO_SOUND)
    }
    // Laute mitten in der Zeile nur aus der erlaubten Liste
    for (const l of lines) {
      for (const m of l.replace(/^(HOST|GUEST)[^:]*:\s*(\[[^\]]*\]\s*)?/, '').matchAll(/\[([^\]]*)\]/g)) {
        expect(isVocalCue(m[1]), m[1]).toBe(true)
      }
    }
  })

  it.each([
    ['EN', VOICE_STYLE_EN],
    ['DE', VOICE_STYLE_DE],
  ])('Stimmen-Stil %s: Paletten ohne Gesten und Gesprächszüge', (_, style) => {
    const palette = style.split('\n').find((l) => /Emma's heated lines|Emmas hitzige Zeilen/.test(l))
    expect(palette).toBeTruthy()
    for (const [, d] of palette!.matchAll(/\[([^\]]+)\]/g)) {
      expect(d, d).not.toMatch(NO_SOUND)
      expect(d.split(/[\s,]+/).filter(Boolean).length, d).toBeLessThanOrEqual(5)
    }
  })

  it.each([
    ['EN', EPISODE_SHAPE_EN],
    ['DE', EPISODE_SHAPE_DE],
  ])('Self-Check %s: prüft Anweisungen nach Gemini-Regeln', (_, shape) => {
    expect(shape).toMatch(/Directions only where the sound changes|Anweisungen nur, wo sich der Klang ändert/)
    expect(shape).not.toMatch(/no second bracket in a line|keine zweite Klammer in einer Zeile/)
  })
})
