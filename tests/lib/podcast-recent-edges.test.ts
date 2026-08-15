/**
 * Das Gedächtnis für Anfänge und Schlüsse.
 *
 * Die Modi in openers.ts verhindern, dass zwei Folgen gleich ANFANGEN. Sie
 * verhindern nicht, dass sich innerhalb eines Modus dieselbe Formulierung
 * einschleift — dafür muss das Modell sehen, was zuletzt lief.
 */
import { describe, expect, it } from 'vitest'
import { extractOpening, extractClosing, recentEdgesSection } from '@/lib/podcast/recent-openings'

const SKRIPT = `HOST: [warm] Hey, Hey und Willkommen bei Synthesizer Daily!
GUEST: [amused] Schön, dass ihr da seid.
HOST: [curious] Heute geht es um Rechenzentren.

[MUSIK]

GUEST: [thoughtful] Am Ende bleibt eine Frage offen.
HOST: [warm] Bis morgen — und empfehlt uns weiter.`

describe('extractOpening / extractClosing', () => {
  it('nimmt die ersten Sprechzeilen', () => {
    const o = extractOpening(SKRIPT)!
    expect(o).toContain('Hey, Hey und Willkommen')
    expect(o).toContain('Schön, dass ihr da seid')
  })

  it('nimmt die letzten Sprechzeilen', () => {
    const c = extractClosing(SKRIPT)!
    expect(c).toContain('Bis morgen')
    expect(c).not.toContain('Hey, Hey und Willkommen')
  })

  it('laesst Regieanweisungen und Marker weg', () => {
    // "[MUSIK]" ist keine Sprechzeile — im Prompt waere es nur Rauschen.
    expect(extractClosing(SKRIPT)).not.toContain('MUSIK')
  })

  it('kommt mit leerem oder fremdem Text klar', () => {
    expect(extractOpening('')).toBeNull()
    expect(extractClosing('nur Fliesstext ohne Sprecher')).toBeNull()
  })
})

describe('recentEdgesSection', () => {
  it('bleibt LEER, wenn es nichts zu vergleichen gibt', () => {
    // Eine Ueberschrift "zuletzt gesendet" ohne Inhalt darunter wuerde das
    // Modell nur verwirren.
    expect(recentEdgesSection({ openings: [], closings: [] }, 'de')).toBe('')
  })

  it('nennt die letzten Anfaenge und fordert eine andere Bewegung', () => {
    const s = recentEdgesSection({ openings: ['Hey, Hey…'], closings: ['Bis morgen…'] }, 'de')
    expect(s).toContain('NICHT WIEDERHOLEN')
    expect(s).toContain('Hey, Hey…')
    expect(s).toContain('Bis morgen…')
    expect(s).toMatch(/andere Bewegung/i)
  })

  it('nimmt den Wiedererkennungssatz ausdruecklich aus', () => {
    // Sonst wuerde das Modell auch die Marke variieren — die soll bleiben.
    const s = recentEdgesSection({ openings: ['x'], closings: ['y'] }, 'de')
    expect(s).toMatch(/Wiedererkennungssatz bleibt davon unberührt/i)
  })
})
