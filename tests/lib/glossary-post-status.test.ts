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
    // Seit 2026-08-09 ein EIGENER Zustand statt 'pending' — s. unten.
    expect(s.state).toBe('images_pending')
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

  // KORREKTUR 2026-08-09: Fehlende Illustrationen hatten denselben Zustand wie
  // eine laufende Erzeugung ('pending') — die UI machte daraus einen Spinner mit
  // 20-Sekunden-Polling. Das war irrefuehrend: der images-Job wurde von nichts
  // angelegt, der Zustand aenderte sich also nie von allein. 284 Begriffe
  // standen so tagelang da, waehrend die Anzeige "arbeitet" signalisierte.
  //
  // Seit dem 08:00-Cron holt ein Lauf sie taeglich nach. Der Zustand heisst
  // deshalb jetzt 'images_pending': etwas fehlt und wird nachgeholt — aber
  // gerade laeuft nichts, worauf sich Warten lohnt.
  describe('fehlende Illustrationen sind kein laufender Lauf', () => {
    it('meldet einen EIGENEN Zustand, nicht pending', () => {
      const s = computeGlossaryPostStatus({
        detectedSlugs: all(12), publishedSlugs: all(12), withImageSlugs: all(11), linkedSlugs: all(12),
      })
      expect(s.state).toBe('images_pending')
      expect(s.state).not.toBe('pending')
    })

    it('nennt die Zahl der fehlenden Illustrationen', () => {
      const s = computeGlossaryPostStatus({
        detectedSlugs: all(12), publishedSlugs: all(12), withImageSlugs: all(9), linkedSlugs: all(12),
      })
      expect(s.label).toContain('3 ohne Illustration')
    })

    it('sagt, dass es nachgeholt wird — nicht dass es laeuft', () => {
      const s = computeGlossaryPostStatus({
        detectedSlugs: all(2), publishedSlugs: all(2), withImageSlugs: all(1), linkedSlugs: all(2),
      })
      expect(s.label).toMatch(/nachgeholt|wird ergänzt/i)
      expect(s.label).not.toMatch(/läuft im Hintergrund/)
    })

    it('bleibt bei pending, solange die ERZEUGUNG laeuft', () => {
      // Der echte Wartefall: da arbeitet tatsaechlich ein Job.
      const s = computeGlossaryPostStatus({
        detectedSlugs: all(12), publishedSlugs: all(3), withImageSlugs: all(3), linkedSlugs: [],
      })
      expect(s.state).toBe('pending')
    })
  })
})
