/**
 * Feed fuer Agenten: Abschnitte je Artikel mit demselben Anker wie das
 * Take-Barometer (queueItemId der H2, sonst idx:N ueber alle Takes). Nur mit
 * identischer Regel landet ein Agenten-Take auf der Seite unter dem Take, den
 * der Agent gelesen hat.
 */
import { describe, expect, it } from 'vitest'
import { sectionsOf } from '@/lib/agents/feed'

const h = (text: string, id?: string) => ({ type: 'heading', attrs: { level: 2, ...(id ? { queueItemId: id } : {}) }, content: [{ type: 'text', text }] })
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

describe('sectionsOf', () => {
  it('nimmt die queueItemId als Anker, trennt Bericht und Take, entfernt die Vorsilbe', () => {
    const s = sectionsOf({ type: 'doc', content: [h('A', 'q1'), p('Bericht A.'), p('Synthszr Take: Meinung A.')] })
    expect(s).toEqual([{ sectionAnchor: 'q1', headline: 'A', report: 'Bericht A.', take: 'Meinung A.', agentTakes: 0 }])
  })

  it('zaehlt idx-Anker ueber ALLE Takes, auch die mit ID', () => {
    const s = sectionsOf({ type: 'doc', content: [
      h('A'), p('a'), p('Synthszr Take: ta'),
      h('B', 'q2'), p('b'), p('Synthszr Take: tb'),
      h('C'), p('c'), p('Synthszr Take: tc'),
    ] })
    expect(s.map((x) => x.sectionAnchor)).toEqual(['idx:0', 'q2', 'idx:2'])
  })

  it('laesst Abschnitte ohne Take weg', () => {
    const s = sectionsOf({ type: 'doc', content: [h('A', 'q1'), p('nur Bericht'), h('B', 'q2'), p('b'), p('Synthszr Take: tb')] })
    expect(s.map((x) => x.sectionAnchor)).toEqual(['q2'])
  })

  it('parst String-Content und liefert bei Unsinn eine leere Liste', () => {
    expect(sectionsOf(JSON.stringify({ type: 'doc', content: [h('A', 'q1'), p('x'), p('Synthszr Take: t')] }))).toHaveLength(1)
    expect(sectionsOf('kaputt')).toEqual([])
    expect(sectionsOf(null)).toEqual([])
  })

  it('fasst mehrere Bericht-Absaetze mit Leerzeile zusammen', () => {
    const s = sectionsOf({ type: 'doc', content: [h('A', 'q1'), p('Eins.'), p('Zwei.'), p('Synthszr Take: t')] })
    expect(s[0].report).toBe('Eins.\n\nZwei.')
  })
})
