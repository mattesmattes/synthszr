/**
 * Feed fuer Agenten: Abschnitte je Artikel mit demselben Anker wie das
 * Take-Barometer (queueItemId der H2, sonst idx:N ueber alle Takes). Nur mit
 * identischer Regel landet ein Agenten-Take auf der Seite unter dem Take, den
 * der Agent gelesen hat.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { sectionsOf } from '@/lib/agents/feed'
import { insertTakeBarometers } from '@/lib/tiptap/dom-processors/take-barometer'

const h = (text: string, id?: string) => ({ type: 'heading', attrs: { level: 2, ...(id ? { queueItemId: id } : {}) }, content: [{ type: 'text', text }] })
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

describe('sectionsOf', () => {
  it('nimmt die queueItemId als Anker, trennt Bericht und Take, entfernt die Vorsilbe', () => {
    const s = sectionsOf({ type: 'doc', content: [h('A', 'q1'), p('Bericht A.'), p('Synthszr Take: Meinung A.')] })
    expect(s).toEqual([{ sectionAnchor: 'q1', headline: 'A', report: 'Bericht A.', take: 'Meinung A.', agentTakes: 0 }])
  })

  it('zaehlt idx nur, solange noch keine ID vorkam; danach erbt ein ID-loser Abschnitt die letzte ID mit ~n', () => {
    // Barometer-Semantik (Review 2026-10-26): findAnchor laeuft rueckwaerts bis
    // zur naechsten Ueberschrift MIT ID, auch ueber ID-lose hinweg.
    const s = sectionsOf({ type: 'doc', content: [
      h('A'), p('a'), p('Synthszr Take: ta'),
      h('B', 'q2'), p('b'), p('Synthszr Take: tb'),
      h('C'), p('c'), p('Synthszr Take: tc'),
    ] })
    expect(s.map((x) => x.sectionAnchor)).toEqual(['idx:0', 'q2', 'q2~2'])
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

// --- Review 2026-10-26: Anker muessen EXAKT dem Take-Barometer entsprechen ----
// Das Barometer laeuft ueber ID-lose H2 hinweg bis zur naechsten H2 MIT ID,
// vergibt ~n-Suffixe bei doppelten Ankern (Wrap-up-Buendel) und zaehlt
// Update-/Synthese-Absaetze im Index mit. Uebersetzungen verlieren IDs
// gelegentlich (translation-service stellt nur bundleType wieder her), der
// gemischte Fall ist also real.
const MIXED = { type: 'doc', content: [
  h('A', 'q1'), p('a'), p('Synthszr Take: ta'),
  h('B'), p('b'), p('Synthszr Take: tb'),               // ID-los → erbt q1 → q1~2
  h('C', 'q1'), p('c'), p('Synthszr Update: uc'),      // Wrap-up-Dublette → q1~3
  h('D'), p('d'), p('Mattes Synthese: md'),            // zaehlt im Index, erbt q1 → q1~4
] }
const NO_IDS = { type: 'doc', content: [h('A'), p('a'), p('Synthszr Take: ta'), h('B'), p('b'), p('Synthszr Update: ub')] }

describe('sectionsOf — Barometer-Semantik', () => {
  it('laeuft ueber ID-lose H2 zur letzten H2 mit ID und haengt ~n an doppelte Anker', () => {
    expect(sectionsOf(MIXED).map((x) => x.sectionAnchor)).toEqual(['q1', 'q1~2', 'q1~3', 'q1~4'])
    expect(sectionsOf(MIXED).map((x) => x.headline)).toEqual(['A', 'B', 'C', 'D'])
  })
  it('zaehlt idx ueber Take-, Update- und Synthese-Absaetze', () => {
    expect(sectionsOf(NO_IDS).map((x) => x.sectionAnchor)).toEqual(['idx:0', 'idx:1'])
    expect(sectionsOf(NO_IDS)[1].take).toBe('ub')
  })
})

describe('sectionsOf == insertTakeBarometers (gleiches Fixture)', () => {
  type Globals = { document: unknown; NodeFilter: unknown; HTMLElement: unknown }
  const g = globalThis as unknown as Globals
  const orig: Globals = { document: g.document, NodeFilter: g.NodeFilter, HTMLElement: g.HTMLElement }
  afterEach(() => { Object.assign(g, orig) })

  function render(doc: { content: Array<{ type: string; attrs?: Record<string, unknown>; content?: Array<{ text: string }> }> }): HTMLElement {
    const html = doc.content.map((n) => {
      const text = n.content?.map((c) => c.text).join('') ?? ''
      if (n.type === 'heading') return `<h2${n.attrs?.queueItemId ? ` data-queue-item-id="${n.attrs.queueItemId}"` : ''}>${text}</h2>`
      return `<p>${text}</p>`
    }).join('')
    const dom = new JSDOM(`<div id="c">${html}</div>`)
    g.document = dom.window.document; g.NodeFilter = dom.window.NodeFilter; g.HTMLElement = dom.window.HTMLElement
    return dom.window.document.getElementById('c') as unknown as HTMLElement
  }

  for (const [name, fixture] of [['gemischt', MIXED], ['ohne IDs', NO_IDS]] as const) {
    it(`liefert fuer "${name}" dieselben Anker wie das Barometer`, () => {
      const dom = insertTakeBarometers(render(fixture as never)).barometers.map((b) => b.anchor)
      expect(sectionsOf(fixture).map((x) => x.sectionAnchor)).toEqual(dom)
    })
  }
})
