/**
 * embedQueueItemIds: Headings, die aus dem Konverter bereits eine queueItemId
 * tragen (data-queue-item-ids-Marker der Pipeline), bleiben unangetastet und
 * reservieren ihre IDs — die Text-Heuristik ist nur noch Fallback fuer
 * unmarkierte Headings (Betreiber-Vorgabe 2026-10-05, Spec Heading-Marker).
 */
import { describe, expect, it } from 'vitest'
import { embedQueueItemIds } from '@/lib/utils/embed-queue-ids'

type Heading = { type: 'heading'; attrs: Record<string, unknown>; content: Array<{ type: 'text'; text: string }> }

function h2(text: string, attrs: Record<string, unknown> = {}): Heading {
  return { type: 'heading', attrs: { level: 2, ...attrs }, content: [{ type: 'text', text }] }
}

const items = [
  { id: 'id-1', title: 'Anthropic stellt Claude vor' },
  { id: 'id-2', title: 'OpenAI zeigt neues Modell' },
  { id: 'id-3', title: 'OpenAI zeigt neues Modell für Entwickler' },
]

describe('embedQueueItemIds', () => {
  it('laesst ein markiertes Heading unangetastet (Marker schlaegt Heuristik)', () => {
    // Heading A traegt id-1 aus dem Marker, sein Text wuerde per Heuristik
    // aber id-2 treffen — heute ueberschreibt die Heuristik den Marker.
    // Heading B ist unmarkiert und bekommt per Heuristik weiterhin id-2.
    // Dass die Marker-ID selbst reserviert wird, prueft erst der Fall
    // „markiertes Heading NACH unmarkiertem" (B trifft id-1 textlich nie).
    const doc = {
      type: 'doc',
      content: [
        h2('OpenAI zeigt neues Modell', { queueItemId: 'id-1' }),
        h2('OpenAI zeigt neues Modell'),
      ],
    }
    embedQueueItemIds(doc, items)
    const [a, b] = doc.content
    expect(a.attrs).toEqual({ level: 2, queueItemId: 'id-1' })
    expect(b.attrs.queueItemId).toBe('id-2')
  })

  it('reserviert auch alle Buendel-Mitglieder aus queueItemIds', () => {
    // Das Buendel-Heading traegt id-2 und id-3. Heading B passt per Heuristik
    // auf beide — beide sind vergeben, id-1 passt textlich nicht: kein Match.
    const doc = {
      type: 'doc',
      content: [
        h2('Bündel-Überschrift', { queueItemId: 'id-2', queueItemIds: 'id-2,id-3', bundleType: 'topic' }),
        h2('OpenAI zeigt neues Modell für Entwickler'),
      ],
    }
    embedQueueItemIds(doc, items)
    const [bundle, b] = doc.content
    expect(bundle.attrs).toEqual({ level: 2, queueItemId: 'id-2', queueItemIds: 'id-2,id-3', bundleType: 'topic' })
    expect(b.attrs.queueItemId).toBeUndefined()
  })

  it('trimmt die Mitglieder aus queueItemIds und uebergeht leere Eintraege', () => {
    // ' id-3' mit Leerzeichen und ein Komma am Ende: ohne trim() laege nur
    // ' id-3' in usedIds, und Heading B bekaeme id-3 (sein bester Treffer).
    const doc = {
      type: 'doc',
      content: [
        h2('Bündel-Überschrift', { queueItemId: 'id-2', queueItemIds: 'id-2, id-3,' }),
        h2('OpenAI zeigt neues Modell für Entwickler'),
      ],
    }
    embedQueueItemIds(doc, items)
    expect(doc.content[1].attrs.queueItemId).toBeUndefined()
  })

  it('reserviert die Marker-ID auch, wenn das markierte Heading NACH dem unmarkierten steht', () => {
    // Das unmarkierte Heading A trifft textlich genau id-1, das markierte
    // Heading B traegt id-1 und steht dahinter. Ohne eigenen Vorlauf (IDs erst
    // beim Erreichen von B reserviert) oder ohne Reservierung der einzelnen
    // queueItemId bekaeme A die id-1 ein zweites Mal — dann zeigten zwei
    // Abschnitte auf dasselbe Item (Thumbnail, Barometer-Anker, Ground Truth).
    const doc = {
      type: 'doc',
      content: [
        h2('Anthropic stellt Claude vor'),
        h2('Irgendwas', { queueItemId: 'id-1' }),
      ],
    }
    embedQueueItemIds(doc, items)
    const [a, marked] = doc.content
    expect(a.attrs.queueItemId).toBeUndefined()
    expect(marked.attrs).toEqual({ level: 2, queueItemId: 'id-1' })
  })

  it('reserviert auch die ID eines markierten H3 (Marker gibt es auf jeder Ebene)', () => {
    // Der Konverter setzt Marker auf jede Heading-Zeile (#{1,6}); das H2 trifft
    // id-1 textlich, die ID gehoert aber verbindlich dem markierten H3.
    const doc = {
      type: 'doc',
      content: [
        h2('Anthropic stellt Claude vor'),
        { type: 'heading', attrs: { level: 3, queueItemId: 'id-1' }, content: [{ type: 'text', text: 'Unterabschnitt' }] },
      ],
    }
    embedQueueItemIds(doc, items)
    expect(doc.content[0].attrs.queueItemId).toBeUndefined()
    expect(doc.content[1].attrs).toEqual({ level: 3, queueItemId: 'id-1' })
  })

  it('behandelt eine leere queueItemId als unmarkiert (Heuristik greift)', () => {
    const doc = {
      type: 'doc',
      content: [h2('Anthropic stellt Claude vor', { queueItemId: '' })],
    }
    embedQueueItemIds(doc, items)
    expect(doc.content[0].attrs.queueItemId).toBe('id-1')
  })

  it('matcht unmarkierte Headings weiterhin per Heuristik (Fallback fuer Alt-Posts)', () => {
    const doc = {
      type: 'doc',
      content: [h2('Anthropic stellt Claude vor'), h2('Synthszr Take')],
    }
    embedQueueItemIds(doc, items)
    expect(doc.content[0].attrs.queueItemId).toBe('id-1')
    expect(doc.content[1].attrs.queueItemId).toBeUndefined()
  })
})
