/**
 * Eröffnungs- und Schluss-Modi des Podcasts.
 *
 * BETREIBER-BEFUND 2026-08-15: Intro und Outro klangen jeden Tag gleich, weil
 * der Prompt die erste Zeile WÖRTLICH vorschrieb und beim Outro einen
 * Beispielsatz mitlieferte, den das Modell übernahm.
 */
import { describe, expect, it } from 'vitest'
import { pickOpener, pickCloser, OPENERS, CLOSERS } from '@/lib/podcast/openers'

describe('Modus-Rotation', () => {
  it('waehlt fuer aufeinanderfolgende Folgen verschiedene Eroeffnungen', () => {
    const acht = Array.from({ length: OPENERS.length }, (_, i) => pickOpener(i).key)
    expect(new Set(acht).size).toBe(OPENERS.length)
  })

  it('wiederholt sich erst nach einer vollen Runde', () => {
    expect(pickOpener(0).key).toBe(pickOpener(OPENERS.length).key)
    expect(pickOpener(0).key).not.toBe(pickOpener(1).key)
  })

  it('laesst Eroeffnung und Schluss NICHT im Gleichschritt laufen', () => {
    // Ein blosser Versatz genuegt NICHT: Bei gleich langen Listen ist die
    // Paarung fest, jede "Widerspruch"-Folge endete immer gleich. Erst
    // unterschiedliche Laengen (8 und 7, teilerfremd) entkoppeln die Achsen.
    const paare = new Set(Array.from({ length: 60 }, (_, i) => pickOpener(i).key + '|' + pickCloser(i).key))
    expect(paare.size).toBe(OPENERS.length * CLOSERS.length)
  })

  it('deckt bei genug Folgen alle Schluesse ab', () => {
    const keys = new Set(Array.from({ length: 40 }, (_, i) => pickCloser(i).key))
    expect(keys.size).toBe(CLOSERS.length)
  })

  it('faellt bei unsinnigen Episodennummern nicht um', () => {
    for (const n of [-5, 0, 1.7, NaN, Infinity]) {
      expect(OPENERS).toContain(pickOpener(n))
      expect(CLOSERS).toContain(pickCloser(n))
    }
  })

  it('jeder Modus traegt eine Anweisung, keine Beispielformulierung', () => {
    // Ein Beispielsatz im Prompt wird vom Modell uebernommen — genau das war die
    // Ursache. Die Modi beschreiben eine TECHNIK, sie liefern keinen Wortlaut.
    for (const m of [...OPENERS, ...CLOSERS]) {
      expect(m.instruction.length).toBeGreaterThan(40)
      expect(m.key).toMatch(/^[a-z-]+$/)
    }
  })
})
