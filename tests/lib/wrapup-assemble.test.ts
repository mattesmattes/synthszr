/**
 * Zusammenbau des Wochenrueckblicks.
 *
 * Hier entscheidet sich, ob die Zusicherung des Designs haelt: die
 * Bericht-Knoten muessen UNVERAENDERT durchgereicht werden — mit ihren
 * link-Marks (Quellen) und glossaryLink-Marks (Lexikon). Genau deshalb wird der
 * Bericht uebernommen statt neu geschrieben.
 */
import { describe, expect, it } from 'vitest'
import { assembleWrapupDoc, buildHeading, selectParagraphs, sourcesParagraph, UPDATE_SOURCES_LABEL } from '@/lib/wrapup/assemble'
import type { TopicUpdate } from '@/lib/wrapup/research'
import type { WrapupTopic } from '@/lib/wrapup/collect'

const sourceParagraph = {
  type: 'paragraph',
  content: [{
    type: 'text',
    text: 'Laut Reuters plant Alibaba.',
    marks: [
      { type: 'link', attrs: { href: 'https://reuters.com/x' } },
      { type: 'glossaryLink', attrs: { 'data-glossary-slug': 'open-weight-modell' } },
    ],
  }],
}

function topic(over: Partial<WrapupTopic> = {}): WrapupTopic {
  return {
    weekday: 'Montag',
    date: '2026-08-03',
    headline: 'Alibaba stellt Qwen vor',
    body: 'Laut Reuters plant Alibaba.',
    takeText: 'Synthszr Take: Langer Original-Take.',
    headingNode: { type: 'heading', attrs: { level: 2, queueItemId: 'q1', bundleType: 'topic' } },
    bodyNodes: [sourceParagraph],
    postSlug: 'mo',
    ...over,
  }
}

describe('buildHeading', () => {
  it('setzt "Wochentag — Original-Headline"', () => {
    const h = buildHeading(topic())
    const text = ((h.content ?? []) as Array<{ text?: string }>)[0]?.text
    expect(text).toBe('Montag — Alibaba stellt Qwen vor')
  })

  it('behaelt die queueItemId des Originals', () => {
    expect((buildHeading(topic()).attrs as Record<string, unknown>).queueItemId).toBe('q1')
  })

  it('entfernt bundleType — im Rueckblick ist jeder Abschnitt Thema des Tages', () => {
    expect((buildHeading(topic()).attrs as Record<string, unknown>).bundleType).toBeUndefined()
  })
})

describe('assembleWrapupDoc', () => {
  const parts = {
    intro: 'Die Woche stand im Zeichen offener Gewichte.',
    sections: [{ weekday: 'Montag', take: 'Kurz und pointiert.', bridge: 'Das setzt den Freitag fort.' }],
  }

  it('reicht die Bericht-Knoten UNVERAENDERT durch — samt Quellen- und Lexikon-Marks', () => {
    // Die zentrale Zusicherung des Designs. Ginge sie verloren, waere der
    // ganze Umbau auf Knoten-Uebernahme sinnlos.
    const doc = assembleWrapupDoc([topic()], parts)
    const nodes = doc.content as Array<Record<string, unknown>>
    const body = nodes.find((n) => JSON.stringify(n).includes('reuters.com'))
    expect(body).toEqual(sourceParagraph)
  })

  it('stellt den Vorlauf ganz nach vorn', () => {
    const doc = assembleWrapupDoc([topic()], parts)
    const first = (doc.content as Array<Record<string, unknown>>)[0]
    expect(JSON.stringify(first)).toContain('offener Gewichte')
    expect(first.type).toBe('paragraph')
  })

  it('ordnet Bezug und Take NACH dem Bericht ein', () => {
    const doc = assembleWrapupDoc([topic()], parts)
    const texts = (doc.content as Array<Record<string, unknown>>).map((n) => JSON.stringify(n))
    const bodyPos = texts.findIndex((t) => t.includes('reuters.com'))
    const bridgePos = texts.findIndex((t) => t.includes('setzt den Freitag fort'))
    const takePos = texts.findIndex((t) => t.includes('Kurz und pointiert'))
    expect(bridgePos).toBeGreaterThan(bodyPos)
    expect(takePos).toBeGreaterThan(bridgePos)
  })

  it('setzt die Take-Vorsilbe selbst', () => {
    const doc = assembleWrapupDoc([topic()], parts)
    const take = (doc.content as Array<Record<string, unknown>>)
      .map((n) => JSON.stringify(n)).find((t) => t.includes('Kurz und pointiert'))
    expect(take).toContain('Synthszr Take: Kurz und pointiert.')
  })

  it('verdoppelt die Vorsilbe nicht, wenn das Modell sie mitliefert', () => {
    const doc = assembleWrapupDoc([topic()], {
      intro: 'X.',
      sections: [{ weekday: 'Montag', take: 'Synthszr Take: Doppelt.' }],
    })
    const s = JSON.stringify(doc)
    expect(s).toContain('Synthszr Take: Doppelt.')
    expect(s).not.toContain('Synthszr Take: Synthszr Take:')
  })

  it('laesst den Bezug weg, wenn das Modell keinen liefert', () => {
    // Der Normalfall: die meisten Themen haengen nicht zusammen.
    const doc = assembleWrapupDoc([topic()], {
      intro: 'X.',
      sections: [{ weekday: 'Montag', take: 'Pointe.' }],
    })
    const nodes = doc.content as Array<Record<string, unknown>>
    // Vorlauf + Heading + Bericht + Take = 4
    expect(nodes).toHaveLength(4)
  })

  it('ordnet ueber den Wochentag zu, nicht ueber die Reihenfolge', () => {
    // Das Modell koennte die Abschnitte in anderer Reihenfolge zurueckgeben.
    const doc = assembleWrapupDoc(
      [topic({ weekday: 'Montag' }), topic({ weekday: 'Freitag', headline: 'F' })],
      { intro: 'X.', sections: [
        { weekday: 'Freitag', take: 'Take Fr.' },
        { weekday: 'Montag', take: 'Take Mo.' },
      ] },
    )
    const texts = (doc.content as Array<Record<string, unknown>>).map((n) => JSON.stringify(n))
    const moHead = texts.findIndex((t) => t.includes('Montag — Alibaba'))
    const moTake = texts.findIndex((t) => t.includes('Take Mo.'))
    const frHead = texts.findIndex((t) => t.includes('Freitag — F'))
    expect(moTake).toBeGreaterThan(moHead)
    expect(moTake).toBeLessThan(frHead)
  })

  it('laesst einen Abschnitt ohne Take lieber leer als mit leerer Vorsilbe', () => {
    const doc = assembleWrapupDoc([topic()], { intro: 'X.', sections: [] })
    expect(JSON.stringify(doc)).not.toContain('Synthszr Take:')
  })
})

// --- Synthszr Update (Spec 2026-10-24) -------------------------------------
// Bei einem Update ersetzt ein „Synthszr Update"-Absatz den Take, darunter die
// Recherche-Quellen als link-Marks. Bei `major` darf der Bericht gekuerzt
// werden — aber nur durch WEGLASSEN ganzer Knoten (keepParagraphs), weil die
// Quellenlinks an den Knoten haengen. Index 0 bleibt immer, mindestens zwei.
type N = Record<string, unknown>
const p = (text: string): N => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const drei: N[] = [sourceParagraph, p('Zweiter.'), p('Dritter.')]
const upd = (level: 'none' | 'minor' | 'major'): TopicUpdate => ({
  weekday: 'Montag', updateLevel: level, summary: 'S',
  sources: [{ url: 'https://reuters.com/u', title: 'Reuters', date: '2026-10-14' }], searches: 1,
})
const texteVon = (doc: N) => (doc.content as N[]).map((n) => JSON.stringify(n))

describe('selectParagraphs', () => {
  it('gibt alle Knoten zurueck, wenn keine Auswahl vorliegt', () => {
    expect(selectParagraphs(drei, undefined)).toEqual(drei)
    expect(selectParagraphs(drei, [])).toEqual(drei)
  })

  it('behaelt Index 0 immer, sortiert, dedupliziert und ignoriert Indizes ausserhalb', () => {
    expect(selectParagraphs(drei, [2, 2, 7])).toEqual([drei[0], drei[2]])
  })

  it('fuellt auf mindestens zwei Knoten auf', () => {
    expect(selectParagraphs(drei, [0])).toEqual([drei[0], drei[1]])
  })

  it('laesst einen einzelnen Knoten einzeln', () => {
    expect(selectParagraphs([drei[0]], [0])).toEqual([drei[0]])
  })
})

describe('assembleWrapupDoc mit Updates', () => {
  const sections = [{ weekday: 'Montag', update: 'Das hat gehalten.', keepParagraphs: [2] }]

  it('setzt bei major nur die gewaehlten Bericht-Knoten ein — unveraendert, samt Marks', () => {
    const doc = assembleWrapupDoc([topic({ bodyNodes: drei })], { intro: 'X.', sections }, [upd('major')])
    const s = JSON.stringify(doc)
    expect(s).toContain('reuters.com/x')
    expect(s).toContain('Dritter.')
    expect(s).not.toContain('Zweiter.')
    expect((doc.content as N[]).find((n) => JSON.stringify(n).includes('reuters.com/x'))).toEqual(sourceParagraph)
  })

  it('ignoriert keepParagraphs bei minor', () => {
    const s = JSON.stringify(assembleWrapupDoc([topic({ bodyNodes: drei })], { intro: 'X.', sections }, [upd('minor')]))
    expect(s).toContain('Zweiter.')
  })

  it('setzt das Update-Label statt des Take-Labels und verdoppelt es nicht', () => {
    const s = JSON.stringify(assembleWrapupDoc(
      [topic()], { intro: 'X.', sections: [{ weekday: 'Montag', update: 'Synthszr Update: Neu.' }] }, [upd('minor')],
    ))
    expect(s).toContain('Synthszr Update: Neu.')
    expect(s).not.toContain('Synthszr Update: Synthszr Update:')
    expect(s).not.toContain('Synthszr Take:')
  })

  it('haengt den Quellen-Absatz mit link-Mark und Datum direkt hinter das Update', () => {
    const doc = assembleWrapupDoc([topic()], { intro: 'X.', sections: [{ weekday: 'Montag', update: 'Neu.' }] }, [upd('minor')])
    const texts = texteVon(doc)
    const u = texts.findIndex((t) => t.includes('Synthszr Update: Neu.'))
    expect(texts[u + 1]).toContain(UPDATE_SOURCES_LABEL)
    expect(texts[u + 1]).toContain('"href":"https://reuters.com/u"')
    expect(texts[u + 1]).toContain('14.10.2026')
  })

  it('nimmt bei Stufe none ein mitgeliefertes update als Take mit Take-Label, ohne Quellen', () => {
    // Die Recherche hat nichts gefunden — dann darf kein „Update" behauptet
    // werden, auch wenn das Modell das Feld fuellt.
    const s = JSON.stringify(assembleWrapupDoc([topic()], { intro: 'X.', sections: [{ weekday: 'Montag', update: 'Doch.' }] }, [upd('none')]))
    expect(s).toContain('Synthszr Take: Doch.')
    expect(s).not.toContain(UPDATE_SOURCES_LABEL)
  })

  it('bleibt ohne Updates beim bisherigen Dokument', () => {
    const basis = { intro: 'X.', sections: [{ weekday: 'Montag', take: 'Kurz.' }] }
    const ohne = assembleWrapupDoc([topic()], basis)
    expect(assembleWrapupDoc([topic()], basis, [])).toEqual(ohne)
    expect(JSON.stringify(ohne)).not.toContain(UPDATE_SOURCES_LABEL)
  })

  it('ordnet den Bezug VOR dem Update ein', () => {
    const texts = texteVon(assembleWrapupDoc(
      [topic()], { intro: 'X.', sections: [{ weekday: 'Montag', update: 'Neu.', bridge: 'Bezug.' }] }, [upd('minor')],
    ))
    expect(texts.findIndex((t) => t.includes('Bezug.'))).toBeLessThan(texts.findIndex((t) => t.includes('Synthszr Update')))
  })
})

describe('sourcesParagraph', () => {
  it('verlinkt jeden Titel und trennt Quellen mit Komma', () => {
    const node = sourcesParagraph([
      { url: 'https://a.de', title: 'A', date: '2026-10-14' },
      { url: 'https://b.de', title: 'B', date: '2026-10-15' },
    ])
    const content = node.content as Array<{ text: string; marks?: Array<{ type: string; attrs: { href: string } }> }>
    expect(content.map((c) => c.text).join('')).toBe('Update-Quellen: A (14.10.2026), B (15.10.2026)')
    expect(content.filter((c) => c.marks?.length).map((c) => c.marks![0].attrs.href)).toEqual(['https://a.de', 'https://b.de'])
  })
})
