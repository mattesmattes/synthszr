import { describe, expect, it } from 'vitest'
import { extractSections, applySectionResult } from '@/lib/enrich/sections'
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
