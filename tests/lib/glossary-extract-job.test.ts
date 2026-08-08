/**
 * Abbruchbedingung des Artikel-Lese-Laufs.
 *
 * Der Lauf liest bis zu 100 Artikel und macht dabei EINEN Modellaufruf je
 * Artikel. Ein Job, der nicht zuverlaessig stoppt, laeuft im Minutentakt weiter
 * und verbrennt ueber Nacht Geld — deshalb ist genau diese Funktion getestet und
 * nicht die Verdrahtung drumherum.
 *
 * Zwei unabhaengige Gruende zu stoppen, und beide muessen greifen:
 *   1. Das Ziel ist erreicht (der Betreiber hat 50 gewaehlt, 50 sind gelesen).
 *   2. Es gibt keine Artikel mehr — dann ist das Ziel unerreichbar, und der Job
 *      muss trotzdem enden statt ewig leere Ticks zu drehen.
 */
import { describe, expect, it } from 'vitest'
import { extractExhausted } from '@/lib/glossary/jobs/advance'

describe('extractExhausted', () => {
  it('laeuft weiter, solange das Ziel nicht erreicht ist', () => {
    expect(extractExhausted(10, 10, 50, false)).toBe(false)
  })

  it('stoppt, wenn das Ziel genau erreicht ist', () => {
    expect(extractExhausted(40, 10, 50, false)).toBe(true)
  })

  it('stoppt, wenn das Ziel ueberschritten wird', () => {
    // Der Tick liest immer POSTS_PER_EXTRACTION Artikel, das Ziel kann also
    // uebersprungen werden (Ziel 45, Ticks à 10).
    expect(extractExhausted(40, 10, 45, false)).toBe(true)
  })

  it('stoppt, wenn keine Artikel mehr da sind — auch wenn das Ziel offen bleibt', () => {
    // Sonst dreht der Job im Minutentakt leere Runden bis zur Eskalation.
    expect(extractExhausted(20, 3, 100, true)).toBe(true)
  })

  it('stoppt bei fehlendem Ziel, sobald der Bestand durch ist', () => {
    // total ist bei diesem Lauf immer gesetzt; ein null darf trotzdem nicht in
    // eine Endlosschleife fuehren.
    expect(extractExhausted(20, 0, null, true)).toBe(true)
    expect(extractExhausted(20, 10, null, false)).toBe(false)
  })
})
