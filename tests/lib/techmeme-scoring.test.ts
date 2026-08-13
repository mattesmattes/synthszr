/**
 * Techmemes Kuration als Bewertung.
 *
 * Betreiber-Entscheidung 2026-08-13: „Techmemes Rangfolge ist bereits eine
 * redaktionelle Bewertung, die wir sonst wegwerfen." Vorher standen die
 * Einträge mit Werten um 0,1 in einer Queue, deren Median bei 6,1 liegt — sie
 * waren praktisch unsichtbar.
 *
 * Die Skala 0–10 ist an der gemessenen Verteilung der pending-Queue
 * ausgerichtet: Median 6,1 · p75 8,6 · p90 9,7 · Maximum 14,9. Eine Top-Story
 * landet damit im obersten Zehntel, eine Randmeldung unten — ohne die eigene
 * Bewertung zu überstimmen.
 */
import { describe, expect, it } from 'vitest'
import { curationScore } from '@/lib/techmeme/scoring'

const TOP = { storyIndex: 0, totalStories: 20, sourceCount: 41, rank: 0 }

describe('curationScore', () => {
  it('gibt der breitesten Meldung ganz oben die Bestnote', () => {
    expect(curationScore(TOP)).toBeCloseTo(10, 1)
  })

  it('bleibt in der Skala 0 bis 10', () => {
    const faelle = [
      TOP,
      { storyIndex: 19, totalStories: 20, sourceCount: 1, rank: 9 },
      { storyIndex: 0, totalStories: 1, sourceCount: 200, rank: 0 },
      { storyIndex: 5, totalStories: 20, sourceCount: 0, rank: 0 },
    ]
    for (const f of faelle) {
      const s = curationScore(f)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(10)
    }
  })

  it('bewertet weiter oben stehende Stories hoeher', () => {
    const oben = curationScore({ ...TOP, storyIndex: 0 })
    const mitte = curationScore({ ...TOP, storyIndex: 10 })
    const unten = curationScore({ ...TOP, storyIndex: 19 })
    expect(oben).toBeGreaterThan(mitte)
    expect(mitte).toBeGreaterThan(unten)
  })

  it('bewertet breit berichtete Meldungen hoeher', () => {
    // Die Breite ist Techmemes zweites Urteil: Berichten 40 Haeuser darueber,
    // ist es ein Grossereignis; bei einem ist es eine Randnotiz.
    const breit = curationScore({ ...TOP, sourceCount: 40 })
    const schmal = curationScore({ ...TOP, sourceCount: 3 })
    expect(breit).toBeGreaterThan(schmal)
  })

  it('saettigt bei der Breite — 80 Quellen sind nicht doppelt so wichtig wie 40', () => {
    const vierzig = curationScore({ ...TOP, sourceCount: 40 })
    const achtzig = curationScore({ ...TOP, sourceCount: 80 })
    expect(achtzig - vierzig).toBeLessThan(0.3)
  })

  it('bevorzugt die Hauptmeldung leicht vor den hinteren Quellen', () => {
    // Rang 0 ist Techmemes Auswahl der besten Darstellung — aber nur leicht:
    // Der Abstand darf nicht groesser sein als der zwischen zwei Stories,
    // sonst schlaegt die zehnte Quelle einer Top-Story die Hauptmeldung der
    // naechsten.
    const erste = curationScore({ ...TOP, rank: 0 })
    const letzte = curationScore({ ...TOP, rank: 9 })
    expect(erste).toBeGreaterThan(letzte)
    expect(erste - letzte).toBeLessThan(3)
  })

  it('gibt der letzten Story mit einer Quelle einen niedrigen, aber echten Wert', () => {
    const s = curationScore({ storyIndex: 19, totalStories: 20, sourceCount: 1, rank: 0 })
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(3)
  })

  it('faellt bei unsinnigen Eingaben nicht um', () => {
    expect(curationScore({ storyIndex: 0, totalStories: 0, sourceCount: 0, rank: 0 })).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(curationScore({ storyIndex: 99, totalStories: 20, sourceCount: 5, rank: 99 }))).toBe(true)
  })

  it('liefert eine Zahl mit einer Nachkommastelle — die Spalte ist NUMERIC(3,1)', () => {
    const s = curationScore({ storyIndex: 3, totalStories: 20, sourceCount: 7, rank: 2 })
    expect(s).toBe(Number(s.toFixed(1)))
  })
})
