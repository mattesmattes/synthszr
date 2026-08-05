/**
 * Lexikon-Ampel für die Preflight-Anzeige.
 *
 * Zweck der Anzeige: die Begriffserzeugung läuft nach dem Speichern asynchron,
 * rund eine Minute je Begriff. Ohne Zahlen ist nicht erkennbar, ob sie arbeitet
 * oder stillsteht — deshalb muss der Zwischenstand "3 von 12" sichtbar sein und
 * nicht bloß "läuft".
 */
import { describe, expect, it } from 'vitest'
import { computeGlossaryPostStatus } from '@/lib/glossary/post-status'

const all = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`)

describe('computeGlossaryPostStatus', () => {
  it('meldet den Zwischenstand mit Zahlen, während die Erzeugung läuft', () => {
    const s = computeGlossaryPostStatus({
      detectedSlugs: all(12), publishedSlugs: all(3), withImageSlugs: all(3), linkedSlugs: [],
    })
    expect(s.state).toBe('pending')
    expect(s.label).toContain('3 von 12')
  })

  it('meldet fehlende Illustrationen, wenn die Texte fertig sind', () => {
    const s = computeGlossaryPostStatus({
      detectedSlugs: all(5), publishedSlugs: all(5), withImageSlugs: all(2), linkedSlugs: all(5),
    })
    expect(s.state).toBe('pending')
    expect(s.label).toContain('3 ohne Illustration')
  })

  it('meldet fehlende Verlinkung als eigenen Zustand', () => {
    // Der Fall, den es in Prod gab: Begriffe existierten, kein Post war verlinkt.
    const s = computeGlossaryPostStatus({
      detectedSlugs: all(4), publishedSlugs: all(4), withImageSlugs: all(4), linkedSlugs: [],
    })
    expect(s.state).toBe('unlinked')
    expect(s.label).toContain('keiner im Artikeltext verlinkt')
  })

  it('ist grün, wenn alles erzeugt, illustriert und verlinkt ist', () => {
    const s = computeGlossaryPostStatus({
      detectedSlugs: all(4), publishedSlugs: all(4), withImageSlugs: all(4), linkedSlugs: all(4),
    })
    expect(s.state).toBe('ok')
    expect(s.label).toBe('Alle 4 Begriffe erzeugt, illustriert und verlinkt')
  })

  it('gilt als in Ordnung, wenn nur EIN TEIL verlinkt ist', () => {
    // GLOSSARY_MAX_PER_ARTICLE deckelt die Marks pro Artikel, und die
    // Kollisionsregel (Company > Produkt > Begriff) kann einen Begriff
    // zurückstellen. Das ist gewolltes Verhalten, kein Mangel.
    const s = computeGlossaryPostStatus({
      detectedSlugs: all(9), publishedSlugs: all(9), withImageSlugs: all(9), linkedSlugs: all(6),
    })
    expect(s.state).toBe('ok')
    expect(s.label).toContain('6 im Artikeltext verlinkt')
  })

  it('zählt nur Begriffe, die in DIESEM Artikel erkannt wurden', () => {
    // Sonst blähte jeder veröffentlichte Begriff des Lexikons die Quote auf und
    // die Ampel wäre immer grün.
    const s = computeGlossaryPostStatus({
      detectedSlugs: ['a', 'b'],
      publishedSlugs: ['a', 'b', 'x', 'y', 'z'],
      withImageSlugs: ['a', 'b', 'x'],
      linkedSlugs: ['a', 'b'],
    })
    expect(s.detected).toBe(2)
    expect(s.generated).toBe(2)
    expect(s.state).toBe('ok')
  })

  it('zählt doppelte Slugs nur einmal', () => {
    const s = computeGlossaryPostStatus({
      detectedSlugs: ['a', 'a', 'b'], publishedSlugs: ['a', 'b'],
      withImageSlugs: ['a', 'b'], linkedSlugs: ['a', 'b'],
    })
    expect(s.detected).toBe(2)
  })

  it('sagt deutlich, wenn im Artikel kein Begriff erkannt wurde', () => {
    const s = computeGlossaryPostStatus({
      detectedSlugs: [], publishedSlugs: all(3), withImageSlugs: all(3), linkedSlugs: [],
    })
    expect(s.state).toBe('none')
  })
})
