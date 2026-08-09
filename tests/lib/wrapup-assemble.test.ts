/**
 * Zusammenbau des Wochenrueckblicks.
 *
 * Hier entscheidet sich, ob die Zusicherung des Designs haelt: die
 * Bericht-Knoten muessen UNVERAENDERT durchgereicht werden — mit ihren
 * link-Marks (Quellen) und glossaryLink-Marks (Lexikon). Genau deshalb wird der
 * Bericht uebernommen statt neu geschrieben.
 */
import { describe, expect, it } from 'vitest'
import { assembleWrapupDoc, buildHeading } from '@/lib/wrapup/assemble'
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
