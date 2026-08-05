/**
 * Nachverlinkung bestehender Artikel.
 *
 * BEFUND, der das nötig macht (2026-08-05, an Prod gemessen): NULL von 219
 * veröffentlichten Posts hatten glossaryLink-Marks. Die Injektion beim Speichern
 * ist korrekt, greift aber nur für Begriffe, die in DIESEM Moment als bestätigter
 * Kandidat vorlagen. Altposts haben nie eine Kandidatenliste gesehen, und ein
 * später entstandener Begriff erreicht keinen älteren Artikel mehr.
 */
import { describe, expect, it } from 'vitest'
import { linkPostContent } from '@/lib/glossary/backfill'

const terms = [
  { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] },
  { slug: 'token', canonicalName: 'Token', aliases: [] },
]

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

function marks(node: unknown): string[] {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    for (const m of (Array.isArray(o.marks) ? o.marks : [])) {
      const mm = m as { type?: string; attrs?: { slug?: string } }
      if (mm.type === 'glossaryLink' && mm.attrs?.slug) out.push(mm.attrs.slug)
    }
    if (Array.isArray(o.content)) o.content.forEach(walk)
  }
  walk(node)
  return out
}

describe('linkPostContent', () => {
  it('verlinkt einen Begriff, der im Text vorkommt', () => {
    const r = linkPostContent(doc('Bei der Inferenz rechnet das Modell.'), terms, [])
    expect(r.changed).toBe(true)
    expect(marks(r.content)).toEqual(['inferenz'])
  })

  it('meldet KEINE Änderung, wenn kein Begriff vorkommt', () => {
    // Der entscheidende Punkt: sonst schreibt der Lauf alle 219 Posts neu, ohne
    // dass sich etwas ändert — sinnlose Schreiblast und 219 geänderte Zeitstempel.
    const r = linkPostContent(doc('Ein Satz ohne Fachbegriffe.'), terms, [])
    expect(r.changed).toBe(false)
  })

  it('meldet KEINE Änderung, wenn die Marks schon gesetzt sind', () => {
    // Zweiter Lauf über denselben Post darf ihn nicht erneut schreiben.
    const first = linkPostContent(doc('Bei der Inferenz rechnet das Modell.'), terms, [])
    const second = linkPostContent(first.content, terms, [])
    expect(second.changed).toBe(false)
  })

  it('respektiert reservierte Namen (Company vor Begriff)', () => {
    // Kollisionsregel des Projekts: Company > Chart-Produkt > Lexikonbegriff.
    const r = linkPostContent(doc('Token ist hier ein Produktname.'), terms, ['Token'])
    expect(marks(r.content)).not.toContain('token')
  })

  it('verkraftet einen leeren Begriffsbestand', () => {
    const r = linkPostContent(doc('Bei der Inferenz rechnet das Modell.'), [], [])
    expect(r.changed).toBe(false)
  })

  it('verkraftet kaputten Content, ohne zu werfen', () => {
    // Ein einzelner unlesbarer Post darf einen Lauf über 219 nicht abbrechen.
    const r = linkPostContent(null, terms, [])
    expect(r.changed).toBe(false)
  })
})
