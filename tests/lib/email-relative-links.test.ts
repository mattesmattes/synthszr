/**
 * Relative Links im Newsletter.
 *
 * BETREIBER-BEFUND 2026-08-11: Im Newsletter standen Glossar-Links als
 * "http:///de/glossary/..." — mit leerem Host. Ursache: der Link stand als
 * normale `link`-Mark mit RELATIVEM href ("/de/glossary/kontextfenster") im
 * Dokument. Eine E-Mail hat keine Base-URL, an der ein relativer Pfad aufgelöst
 * werden könnte; Clients machen daraus ein kaputtes "http:///…".
 *
 * An Prod gemessen: 36 solcher relativen Links in den letzten 12 Artikeln,
 * ausnahmslos Glossar-Links. Sie entstehen, wenn die glossaryLink-Mark über den
 * Editor als gewöhnlicher <a href="/de/…"> serialisiert und wieder eingelesen
 * wird — die dedizierte `glossaryLink`-Mark baut ihre URL dagegen absolut.
 *
 * Der Test deckt bewusst JEDEN relativen Link ab, nicht nur Glossar: dieselbe
 * Falle steht bei jedem internen Link offen.
 */
import { describe, expect, it } from 'vitest'
import { convertTiptapToHtml } from '@/lib/email/tiptap-to-html'

function docWithLink(href: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Begriff', marks: [{ type: 'link', attrs: { href } }] },
        ],
      },
    ],
  }
}

describe('convertTiptapToHtml — relative Links', () => {
  it('macht einen relativen Glossar-Link absolut', () => {
    const html = convertTiptapToHtml(docWithLink('/de/glossary/kontextfenster'))
    expect(html).toContain('https://www.synthszr.com/de/glossary/kontextfenster')
    // Kein href, das direkt mit "/" beginnt — genau daraus wird "http:///…".
    expect(html).not.toMatch(/href="\/(?!\/)/)
  })

  it('macht jeden internen Pfad absolut, nicht nur Glossar', () => {
    const html = convertTiptapToHtml(docWithLink('/de/posts/mein-artikel'))
    expect(html).toContain('https://www.synthszr.com/de/posts/mein-artikel')
  })

  it('laesst absolute Links unveraendert', () => {
    const html = convertTiptapToHtml(docWithLink('https://example.com/artikel'))
    expect(html).toContain('https://example.com/artikel')
    expect(html).not.toContain('synthszr.com/https')
  })

  it('fasst protokollrelative Links nicht an', () => {
    // "//cdn.example.com/x" ist absolut (erbt das Protokoll) — ein Praefix
    // wuerde daraus "https://www.synthszr.com//cdn…" machen.
    const html = convertTiptapToHtml(docWithLink('//cdn.example.com/bild.png'))
    expect(html).not.toContain('synthszr.com//cdn.example.com')
  })

  it('laesst Anker unveraendert', () => {
    const html = convertTiptapToHtml(docWithLink('#abschnitt'))
    expect(html).not.toContain('synthszr.com#')
  })
})
