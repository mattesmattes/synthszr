/**
 * {Company}-Tags serverseitig (2026-10-19): die Erkennung zog aus der Seite
 * „AI Artikel erstellen“ in eine Bibliothek, weil die Ratings-Vorwärmung jetzt
 * im Artikel-Job läuft und nicht mehr im Browser.
 */
import { describe, expect, it } from 'vitest'
import { collectTiptapText, extractCompanyTags } from '@/lib/synthszr/company-tags'

describe('extractCompanyTags', () => {
  it('ordnet Tags case-insensitiv bekannten Firmen zu, ohne Dubletten; Unbekanntes faellt weg', () => {
    const r = extractCompanyTags('Text {Nvidia} und {NVIDIA} und {Unbekannte Firma AG} und {Microsoft}')
    expect(r.public.length).toBe(2)
    expect(new Set(r.public).size).toBe(2)
    expect(r.premarket).toEqual([])
  })

  it('leer ohne Tags', () => {
    expect(extractCompanyTags('kein Tag hier')).toEqual({ public: [], premarket: [] })
  })
})

describe('collectTiptapText', () => {
  it('sammelt Textknoten rekursiv ein', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A {Nvidia}' }, { type: 'text', text: 'B' }] }, { type: 'heading', content: [{ type: 'text', text: 'C' }] }] }
    expect(collectTiptapText(doc).replace(/\s+/g, ' ').trim()).toBe('A {Nvidia} B C')
  })
})
