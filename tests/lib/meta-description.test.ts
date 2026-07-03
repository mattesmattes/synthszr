import { describe, it, expect } from 'vitest'
import { cleanMetaDescription } from '@/lib/i18n/metadata'

describe('cleanMetaDescription', () => {
  it('entfernt Bullets und Zeilenumbrüche und kollabiert Whitespace', () => {
    const raw = 'Intro-Satz.\n• Erster Punkt\n• Zweiter  Punkt'
    expect(cleanMetaDescription(raw)).toBe('Intro-Satz. Erster Punkt Zweiter Punkt')
  })

  it('kürzt auf ~155 Zeichen an einer Wortgrenze mit Ellipse', () => {
    const raw = 'Wort '.repeat(60) // 300 Zeichen
    const out = cleanMetaDescription(raw)
    expect(out.length).toBeLessThanOrEqual(156)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toMatch(/\sWor…$/) // kein mitten-im-Wort-Schnitt
  })

  it('lässt kurze saubere Texte unverändert', () => {
    expect(cleanMetaDescription('Kurz und sauber.')).toBe('Kurz und sauber.')
  })
})
