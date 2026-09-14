/**
 * Nachverlinkung bestehender Artikel.
 *
 * BEFUND, der das nötig macht (2026-08-05, an Prod gemessen): NULL von 219
 * veröffentlichten Posts hatten glossaryLink-Marks. Die Injektion beim Speichern
 * ist korrekt, greift aber nur für Begriffe, die in DIESEM Moment als bestätigter
 * Kandidat vorlagen. Altposts haben nie eine Kandidatenliste gesehen, und ein
 * später entstandener Begriff erreicht keinen älteren Artikel mehr.
 */
import { describe, expect, it, vi } from 'vitest'
import { linkPostContent } from '@/lib/glossary/backfill'

// injectGlossaryMarks fragt seit der Erwaehnungs-Kontext-QS (2026-09-14) pro
// Kandidat eine Kurzbeschreibung nach (fetchSummaries) — ein echter, wenn auch
// kleiner DB-Zugriff. Diese Datei prueft die Nachverlinkungs-Logik, nicht die
// neue QS-Schicht, deshalb hier gemockt: leere Ergebnisliste ⇒ kein Kandidat
// bekommt eine Summary ⇒ die QS greift gar nicht ⇒ exakt das Verhalten von
// vor dem Umbau.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
  }),
}))

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
  it('verlinkt einen Begriff, der im Text vorkommt', async () => {
    const r = await linkPostContent(doc('Bei der Inferenz rechnet das Modell.'), terms, [])
    expect(r.changed).toBe(true)
    expect(marks(r.content)).toEqual(['inferenz'])
  })

  it('meldet KEINE Änderung, wenn kein Begriff vorkommt', async () => {
    // Der entscheidende Punkt: sonst schreibt der Lauf alle 219 Posts neu, ohne
    // dass sich etwas ändert — sinnlose Schreiblast und 219 geänderte Zeitstempel.
    const r = await linkPostContent(doc('Ein Satz ohne Fachbegriffe.'), terms, [])
    expect(r.changed).toBe(false)
  })

  it('meldet KEINE Änderung, wenn die Marks schon gesetzt sind', async () => {
    // Zweiter Lauf über denselben Post darf ihn nicht erneut schreiben.
    const first = await linkPostContent(doc('Bei der Inferenz rechnet das Modell.'), terms, [])
    const second = await linkPostContent(first.content, terms, [])
    expect(second.changed).toBe(false)
  })

  it('respektiert reservierte Namen (Company vor Begriff)', async () => {
    // Kollisionsregel des Projekts: Company > Chart-Produkt > Lexikonbegriff.
    const r = await linkPostContent(doc('Token ist hier ein Produktname.'), terms, ['Token'])
    expect(marks(r.content)).not.toContain('token')
  })

  it('verkraftet einen leeren Begriffsbestand', async () => {
    const r = await linkPostContent(doc('Bei der Inferenz rechnet das Modell.'), [], [])
    expect(r.changed).toBe(false)
  })

  it('verkraftet kaputten Content, ohne zu werfen', async () => {
    // Ein einzelner unlesbarer Post darf einen Lauf über 219 nicht abbrechen.
    const r = await linkPostContent(null, terms, [])
    expect(r.changed).toBe(false)
  })
})

describe('linkPostContent — Deckel', () => {
  it('deckelt die GESETZTEN Marks, nicht die Auswahl der Kandidaten', async () => {
    // PROD-BEFUND 2026-08-05: der Backfill setzte 0 Marks, obwohl 16 Begriffe im
    // Text standen. Ursache war ein .slice(0, MAX) VOR dem Matching: es nahm die
    // ersten Begriffe in DB-Reihenfolge, nicht die im Text vorkommenden. Mit 101
    // Begriffen im Lexikon war keiner der ersten acht im Artikel — Ergebnis null.
    //
    // Der Test schiebt 30 nicht vorkommende Begriffe VOR den einen, der im Text
    // steht. Mit dem alten Verhalten bleibt er unter dem Deckel und wird nie
    // gesetzt; richtig ist, dass er verlinkt wird.
    const many = Array.from({ length: 30 }, (_, i) => ({
      slug: `fehlt-${i}`, canonicalName: `Nichtvorkommend${i}`, aliases: [],
    }))
    const withTarget = [...many, { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] }]
    const r = await linkPostContent(doc('Bei der Inferenz rechnet das Modell.'), withTarget, [])
    expect(r.changed).toBe(true)
    expect(marks(r.content)).toEqual(['inferenz'])
  })
})
