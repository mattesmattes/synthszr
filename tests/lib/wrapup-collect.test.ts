/**
 * Themenauswahl je Wochentag.
 *
 * Regel (Betreiber 2026-08-09): der Abschnitt mit bundleType 'topic'; fehlt er,
 * der ERSTE Abschnitt des Tages. Der Fallback ist kein Randfall — an Prod
 * gemessen hatte Dienstag der 04.08.2026 keinen topic-Abschnitt, in der ersten
 * geprueften Woche ueberhaupt.
 */
import { describe, expect, it } from 'vitest'
import { pickTopicFromPost } from '@/lib/wrapup/collect'

function heading(text: string, bundleType?: string) {
  return {
    type: 'heading',
    attrs: { level: 2, ...(bundleType ? { bundleType } : {}) },
    content: [{ type: 'text', text }],
  }
}
function para(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

describe('pickTopicFromPost', () => {
  it('nimmt den topic-Abschnitt, auch wenn er nicht der erste ist', () => {
    const doc = { type: 'doc', content: [
      heading('Erste News'), para('Text A.'),
      heading('Thema des Tages', 'topic'), para('Text B.'), para('Text C.'),
      heading('Dritte News'), para('Text D.'),
    ] }
    const r = pickTopicFromPost(doc)
    expect(r?.headline).toBe('Thema des Tages')
    expect(r?.body).toContain('Text B.')
    expect(r?.body).toContain('Text C.')
  })

  it('sammelt den Abschnitt bis zur naechsten Ueberschrift, nicht weiter', () => {
    const doc = { type: 'doc', content: [
      heading('Thema', 'topic'), para('Gehoert dazu.'),
      heading('Naechste'), para('Gehoert NICHT dazu.'),
    ] }
    const r = pickTopicFromPost(doc)
    expect(r?.body).toContain('Gehoert dazu.')
    expect(r?.body).not.toContain('NICHT')
  })

  it('faellt auf den ERSTEN Abschnitt zurueck, wenn kein topic markiert ist', () => {
    const doc = { type: 'doc', content: [
      heading('Erste News'), para('Text A.'),
      heading('Zweite News'), para('Text B.'),
    ] }
    const r = pickTopicFromPost(doc)
    expect(r?.headline).toBe('Erste News')
    expect(r?.body).toContain('Text A.')
  })

  it('ignoriert einen recap-Abschnitt bei der Suche nach topic', () => {
    const doc = { type: 'doc', content: [
      heading('Nachlese', 'recap'), para('Text R.'),
      heading('Thema', 'topic'), para('Text T.'),
    ] }
    expect(pickTopicFromPost(doc)?.headline).toBe('Thema')
  })

  it('liefert null bei einem Artikel ohne Ueberschriften', () => {
    expect(pickTopicFromPost({ type: 'doc', content: [para('Nur Text.')] })).toBeNull()
  })

  it('verkraftet null, kaputtes JSON und fremde Formen', () => {
    expect(pickTopicFromPost(null)).toBeNull()
    expect(pickTopicFromPost({})).toBeNull()
    expect(pickTopicFromPost('kein json')).toBeNull()
  })

  it('liest Content auch als JSON-String', () => {
    // generated_posts.content kommt je nach Schreibpfad als String oder Objekt.
    const doc = { type: 'doc', content: [heading('Thema', 'topic'), para('Text.')] }
    expect(pickTopicFromPost(JSON.stringify(doc))?.headline).toBe('Thema')
  })

  // KORREKTUR 2026-08-09: Der Bericht wird 1:1 uebernommen, nicht neu
  // formuliert. Grund sind die Marks: Quellenlinks stecken ausschliesslich in
  // den link-Marks des Originals, ihre URLs waeren nach einer Neuformulierung
  // unwiederbringlich. Deshalb liefert die Funktion jetzt die ROHEN KNOTEN.
  describe('rohe Knoten fuer die Uebernahme', () => {
    it('trennt Bericht-Absaetze vom Synthszr Take', () => {
      const doc = { type: 'doc', content: [
        heading('Thema', 'topic'),
        para('Bericht eins.'),
        para('Bericht zwei.'),
        para('Synthszr Take: Die Pointe.'),
      ] }
      const r = pickTopicFromPost(doc)
      expect(r?.bodyNodes).toHaveLength(2)
      expect(r?.takeText).toContain('Die Pointe.')
    })

    it('gibt den Heading-Knoten mit seinen Attributen zurueck', () => {
      // queueItemId und bundleType haengen daran und sollen erhalten bleiben.
      const doc = { type: 'doc', content: [heading('Thema', 'topic'), para('Text.')] }
      const r = pickTopicFromPost(doc)
      expect((r?.headingNode?.attrs as Record<string, unknown>).bundleType).toBe('topic')
    })

    it('kommt ohne Take zurecht — dann sind alle Absaetze Bericht', () => {
      const doc = { type: 'doc', content: [heading('Thema'), para('Nur Bericht.')] }
      const r = pickTopicFromPost(doc)
      expect(r?.bodyNodes).toHaveLength(1)
      expect(r?.takeText).toBe('')
    })
  })
})
