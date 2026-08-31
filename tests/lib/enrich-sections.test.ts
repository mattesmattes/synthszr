import { describe, expect, it } from 'vitest'
import { extractSections, selectSectionsForEnrich, applySectionResult } from '@/lib/enrich/sections'
import type { TiptapDoc, TiptapNode } from '@/lib/email/tiptap-to-html'

function h2(text: string, attrs: Record<string, string> = {}): TiptapNode {
  return { type: 'heading', attrs: { level: 2, ...attrs }, content: [{ type: 'text', text }] }
}
function p(text: string): TiptapNode {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

describe('extractSections', () => {
  it('zerlegt an H2-Grenzen und traegt queueItemId/bundleType/isTake korrekt', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        p('Intro vor der ersten Ueberschrift — gehoert zu keinem Abschnitt'),
        h2('Erste News', { queueItemId: 'q1' }),
        p('Text 1'),
        h2('Zweite News', { queueItemId: 'q2', bundleType: 'topic' }),
        p('Text 2a'),
        p('Text 2b'),
        h2('Synthszr Take'),
        p('Take-Text'),
      ],
    }
    const sections = extractSections(doc)
    expect(sections).toHaveLength(3)
    expect(sections[0]).toMatchObject({ queueItemId: 'q1', bundleType: null, isTake: false, startIndex: 1, endIndex: 3 })
    expect(sections[1]).toMatchObject({ queueItemId: 'q2', bundleType: 'topic', isTake: false, startIndex: 3, endIndex: 6 })
    expect(sections[2]).toMatchObject({ queueItemId: null, isTake: true, startIndex: 6, endIndex: 8 })
  })

  it('liefert leeres Array ohne H2', () => {
    expect(extractSections({ type: 'doc', content: [p('nur Text')] })).toHaveLength(0)
  })
})

describe('selectSectionsForEnrich', () => {
  const mk = (n: number, id: string, bundleType: 'topic' | 'recap' | 'deep_dive' | null = null, isTake = false) => ({
    startIndex: n, endIndex: n + 1, queueItemId: isTake ? null : id, bundleType, isTake, headingText: id,
  })

  it('waehlt Take immer, unabhaengig vom Score', () => {
    const sections = [mk(0, '', null, true)]
    expect(selectSectionsForEnrich(sections, new Map())).toHaveLength(1)
  })

  it('waehlt die Top 3 nach Score aus 5 unlabeled Abschnitten', () => {
    const sections = [mk(0, 'a'), mk(1, 'b'), mk(2, 'c'), mk(3, 'd'), mk(4, 'e')]
    const scores = new Map([['a', 10], ['b', 50], ['c', 5], ['d', 90], ['e', 30]])
    const chosen = selectSectionsForEnrich(sections, scores).map((s) => s.queueItemId)
    expect(chosen.sort()).toEqual(['b', 'd', 'e']) // 90, 50, 30 — Top 3
  })

  it('nimmt gelabelte Abschnitte zusaetzlich, auch wenn sie NICHT in den Top 3 sind', () => {
    const sections = [mk(0, 'a'), mk(1, 'b'), mk(2, 'c'), mk(3, 'd'), mk(4, 'e', 'deep_dive')]
    const scores = new Map([['a', 10], ['b', 50], ['c', 5], ['d', 90], ['e', 1]]) // e hat den niedrigsten Score
    const chosen = selectSectionsForEnrich(sections, scores).map((s) => s.queueItemId)
    // Top 3 nach Score: d(90), b(50), a(10) — c(5) faellt raus. Plus e ueber Label.
    expect(chosen.sort()).toEqual(['a', 'b', 'd', 'e'])
  })

  it('Take + Top 3 + Label ergeben zusammen wie im Anwendungsfall beschrieben "meist rund 5"', () => {
    const sections = [
      mk(0, '', null, true),
      mk(1, 'a'), mk(2, 'b', 'topic'), mk(3, 'c'), mk(4, 'd'), mk(5, 'e'),
    ]
    const scores = new Map([['a', 10], ['b', 1], ['c', 90], ['d', 50], ['e', 30]])
    const chosen = selectSectionsForEnrich(sections, scores)
    // Take + Top3(c,d,e) + Label(b) = 5
    expect(chosen).toHaveLength(5)
    expect(chosen.some((s) => s.isTake)).toBe(true)
  })

  it('fehlender Score gilt als 0 — qualifiziert nicht ueber Top 3, kann aber ueber Label', () => {
    const sections = [mk(0, 'a'), mk(1, 'b'), mk(2, 'c'), mk(3, 'd', 'recap')]
    const scores = new Map([['a', 10], ['b', 20], ['c', 30]]) // d fehlt komplett
    const chosen = selectSectionsForEnrich(sections, scores).map((s) => s.queueItemId)
    expect(chosen.sort()).toEqual(['a', 'b', 'c', 'd']) // a,b,c als Top3 (nur 3 Kandidaten ohne d), d ueber Label
  })

  it('doppelt qualifizierende Abschnitte (Top 3 UND Label) erscheinen nur einmal', () => {
    const sections = [mk(0, 'a', 'topic'), mk(1, 'b'), mk(2, 'c')]
    const scores = new Map([['a', 100], ['b', 50], ['c', 10]])
    const chosen = selectSectionsForEnrich(sections, scores)
    expect(chosen).toHaveLength(3) // a nur einmal, nicht doppelt
  })
})

describe('applySectionResult', () => {
  it('splict per queueItemId, nicht per Index — bleibt korrekt, wenn ein FRUEHERER Abschnitt bereits die Knotenzahl geaendert hat', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        h2('Erste', { queueItemId: 'q1' }), p('kurz'),
        h2('Zweite', { queueItemId: 'q2' }), p('Text 2'),
      ],
    }
    // Simuliert: Abschnitt q1 wurde bereits durch einen LAENGEREN Text ersetzt
    // (3 Absaetze statt 1) — der urspruengliche Index von q2 (2) stimmt jetzt
    // nicht mehr mit seiner tatsaechlichen Position ueberein.
    const afterFirst = applySectionResult(doc, {
      queueItemId: 'q1', isTake: false,
      nodes: [h2('Erste ueberarbeitet', { queueItemId: 'q1' }), p('a'), p('b'), p('c')],
    })
    expect(afterFirst).not.toBeNull()
    expect(afterFirst!.content).toHaveLength(6) // 2 (neue q1-Section) -> 4 Knoten + 2 fuer q2

    // q2 jetzt anreichern — MUSS trotz verschobener Position korrekt greifen
    const afterSecond = applySectionResult(afterFirst!, {
      queueItemId: 'q2', isTake: false,
      nodes: [h2('Zweite ueberarbeitet', { queueItemId: 'q2' }), p('neu')],
    })
    expect(afterSecond).not.toBeNull()
    const headings = afterSecond!.content!.filter((n) => n.type === 'heading').map((n) => n.content?.[0]?.text)
    expect(headings).toEqual(['Erste ueberarbeitet', 'Zweite ueberarbeitet'])
  })

  it('findet den Take-Abschnitt ueber isTake, nicht ueber queueItemId (der Take hat keinen)', () => {
    const doc: TiptapDoc = { type: 'doc', content: [h2('Synthszr Take'), p('alt')] }
    const result = applySectionResult(doc, { queueItemId: null, isTake: true, nodes: [h2('Synthszr Take'), p('neu, schärfer')] })
    expect(result!.content![1].content![0].text).toBe('neu, schärfer')
  })

  it('gibt null zurueck, wenn der Zielabschnitt nicht mehr existiert', () => {
    const doc: TiptapDoc = { type: 'doc', content: [h2('Andere', { queueItemId: 'q9' })] }
    expect(applySectionResult(doc, { queueItemId: 'q-geloescht', isTake: false, nodes: [] })).toBeNull()
  })

  it('mutiert das Original-Dokument nicht', () => {
    const doc: TiptapDoc = { type: 'doc', content: [h2('X', { queueItemId: 'q1' }), p('alt')] }
    const original = JSON.stringify(doc)
    applySectionResult(doc, { queueItemId: 'q1', isTake: false, nodes: [h2('Y', { queueItemId: 'q1' })] })
    expect(JSON.stringify(doc)).toBe(original)
  })
})
