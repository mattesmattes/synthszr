/**
 * Woechentlich neue Eroeffnungen und Schluesse.
 *
 * BETREIBER-VORGABE 2026-08-15: keine feste Zahl mehr, sondern jede Woche neue.
 * Eine feste Liste wirkt gegen Wiederholung nur so lange, wie sie neu ist —
 * nach einer vollen Runde ist sie selbst das Muster.
 */
import { describe, expect, it } from 'vitest'
import { weekKey, isUsable, buildModePrompt } from '@/lib/podcast/mode-generator'
import { OPENERS, CLOSERS, pickOpener, pickCloser } from '@/lib/podcast/openers'

describe('weekKey', () => {
  it('gibt fuer jeden Tag derselben Woche denselben Montag', () => {
    const mo = weekKey(new Date('2026-08-10T23:00:00Z'))
    const so = weekKey(new Date('2026-08-16T05:00:00Z'))
    expect(mo).toBe('2026-08-10')
    expect(so).toBe('2026-08-10')
  })
  it('wechselt zum naechsten Montag', () => {
    expect(weekKey(new Date('2026-08-17T00:00:00Z'))).toBe('2026-08-17')
  })
})

describe('isUsable', () => {
  const gut = { openers: Array(3).fill({ key: 'a-b', instruction: 'x'.repeat(40) }), closers: Array(3).fill({ key: 'c-d', instruction: 'y'.repeat(40) }), week: '2026-08-10', generatedAt: '' }

  it('nimmt einen vollstaendigen Satz an', () => {
    expect(isUsable(gut)).toBe(true)
  })

  it('lehnt einen Satz OHNE Schluesse ab', () => {
    // Waere er gueltig, endete jede Folge gleich — und niemand kaeme auf die
    // Idee, die Ursache in einer Einstellung zu suchen.
    expect(isUsable({ ...gut, closers: [] })).toBe(false)
  })

  it('lehnt leere oder zu knappe Anweisungen ab', () => {
    expect(isUsable({ ...gut, openers: [{ key: 'x', instruction: 'kurz' }] })).toBe(false)
    expect(isUsable(null)).toBe(false)
    expect(isUsable({})).toBe(false)
  })
})

describe('Modi-Auswahl mit uebergebener Liste', () => {
  it('nutzt die uebergebenen Modi statt der eingebauten', () => {
    const eigene = [{ key: 'neu-eins', instruction: 'i'.repeat(40) }, { key: 'neu-zwei', instruction: 'i'.repeat(40) }]
    expect(pickOpener(0, eigene).key).toBe('neu-eins')
    expect(pickOpener(1, eigene).key).toBe('neu-zwei')
  })

  it('faellt bei leerer Liste auf die eingebauten zurueck', () => {
    // Ein Podcast ohne Einstieg waere der schlechtere Tausch.
    expect(OPENERS).toContain(pickOpener(0, []))
    expect(CLOSERS).toContain(pickCloser(0, []))
  })
})

describe('buildModePrompt', () => {
  it('verbietet Beispielsaetze ausdruecklich', () => {
    // Genau daran ist die erste Fassung gescheitert: Ein Beispiel im Prompt
    // wird woertlich uebernommen.
    const p = buildModePrompt(OPENERS, CLOSERS, 'de')
    expect(p).toMatch(/niemals einen Beispielsatz/i)
  })

  it('zeigt die bisherigen Arten, damit keine Umbenennungen kommen', () => {
    const p = buildModePrompt(OPENERS, CLOSERS, 'de')
    expect(p).toContain(OPENERS[0].key)
    expect(p).toContain(CLOSERS[0].key)
    expect(p).toMatch(/Umbenennungen sind wertlos/i)
  })

  it('haelt die Begruessungsregel fest', () => {
    expect(buildModePrompt(OPENERS, CLOSERS, 'de')).toMatch(/NACHGESCHOBEN/)
  })
})
