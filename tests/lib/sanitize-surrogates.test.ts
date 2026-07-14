import { describe, expect, it } from 'vitest'
import { stripLoneSurrogates } from '@/lib/claude/sanitize'

// U+1F600 GRINNING FACE = 😀 (ein Surrogate-Paar)
const EMOJI = '😀'

describe('stripLoneSurrogates', () => {
  it('lässt normalen Text unverändert', () => {
    expect(stripLoneSurrogates('Nvidia meldet Rekordumsatz.')).toBe('Nvidia meldet Rekordumsatz.')
  })

  it('lässt vollständige Surrogate-Paare (Emoji) intakt', () => {
    expect(stripLoneSurrogates(`Kaffee ${EMOJI} zum Frühstück`)).toBe(`Kaffee ${EMOJI} zum Frühstück`)
  })

  it('entfernt ein einzelnes High-Surrogate am Ende (der slice-cut-Fall)', () => {
    // slice() schneidet ein Emoji-Paar mitten durch → nur das High-Surrogate bleibt
    const cut = `AI memory shortage ${EMOJI}`.slice(0, 'AI memory shortage '.length + 1)
    expect(cut.endsWith('\uD83D')).toBe(true) // Vorbedingung: kaputt
    expect(stripLoneSurrogates(cut)).toBe('AI memory shortage ')
  })

  it('entfernt ein einzelnes Low-Surrogate am Anfang', () => {
    expect(stripLoneSurrogates('\uDE00 Rest des Textes')).toBe(' Rest des Textes')
  })

  it('macht den geschnittenen String well-formed (JSON-safe für die Anthropic-API)', () => {
    // Reproduziert den 400-Fehler: lone surrogate → encodeURIComponent wirft URIError
    const cut = `text ${EMOJI}`.slice(0, 6)
    expect(() => encodeURIComponent(cut)).toThrow() // Vorbedingung: nicht well-formed
    expect(() => encodeURIComponent(stripLoneSurrogates(cut))).not.toThrow()
  })

  it('behandelt leeren String', () => {
    expect(stripLoneSurrogates('')).toBe('')
  })
})
