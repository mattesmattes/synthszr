/**
 * Marker „Synthszr Update:" in den DOM-Prozessoren (Spec 2026-10-24).
 *
 * Der Wochenrueckblick ersetzt den Take durch ein Update. Alle Prozessoren
 * erkennen Takes nur per Text-Regex — ohne diese Erweiterung haette das Update
 * kein gelbes Label, kein Barometer und keinen Promo-Slot.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { isSyntheseText } from '@/lib/tiptap/dom-processors/utils'
import { insertTakeBarometers } from '@/lib/tiptap/dom-processors/take-barometer'
import { insertTipPromoSlot } from '@/lib/tiptap/dom-processors/tip-promo-slot'

const html = '<h2 data-queue-item-id="q1">Montag — X</h2><p>Bericht.</p><p>Synthszr Update: Neu.</p>'

type Globals = { document: unknown; NodeFilter: unknown; HTMLElement: unknown }
const g = globalThis as unknown as Globals
const orig: Globals = { document: g.document, NodeFilter: g.NodeFilter, HTMLElement: g.HTMLElement }

function container(h: string): HTMLElement {
  const dom = new JSDOM(`<div id="c">${h}</div>`)
  g.document = dom.window.document
  g.NodeFilter = dom.window.NodeFilter
  g.HTMLElement = dom.window.HTMLElement
  return dom.window.document.getElementById('c') as unknown as HTMLElement
}

afterEach(() => { Object.assign(g, orig) })

describe('Marker Synthszr Update', () => {
  it('isSyntheseText erkennt den Update-Marker', () => {
    expect(isSyntheseText('Synthszr Update: x')).toBe(true)
  })

  it('insertTakeBarometers setzt ein Barometer unter das Update mit der queueItemId der H2 als Anker', () => {
    const r = insertTakeBarometers(container(html))
    expect(r.barometers).toHaveLength(1)
    expect(r.barometers[0].anchor).toBe('q1')
  })

  it('insertTipPromoSlot findet das Update als ersten Take', () => {
    expect(insertTipPromoSlot(container(html))).not.toBeNull()
  })

  // Review-Befund 2026-10-24: der Kommentar-Block (p.after) landete ZWISCHEN
  // Update und „Update-Quellen" — die Quellenzeile sah aus wie Teil der
  // Leser-Kommentare.
  it('setzt den Kommentar-Block HINTER den Quellen-Absatz des Updates', () => {
    const c = container(html + '<p>Update-Quellen: Reuters (14.10.2026)</p>')
    const r = insertTakeBarometers(c)
    const quellen = Array.from(c.querySelectorAll('p')).find((el) => el.textContent?.startsWith('Update-Quellen:'))!
    expect(quellen.nextElementSibling?.classList.contains('section-comments-slot')).toBe(true)
    expect(r.sectionComments).toHaveLength(1)
  })

  it('bleibt mit Quellen-Absatz idempotent — ein zweiter Lauf setzt keinen zweiten Block', () => {
    const c = container(html + '<p>Update-Quellen: Reuters (14.10.2026)</p>')
    insertTakeBarometers(c)
    const r = insertTakeBarometers(c)
    expect(c.querySelectorAll('.section-comments-slot')).toHaveLength(1)
    expect(r.sectionComments).toHaveLength(1)
  })
})
