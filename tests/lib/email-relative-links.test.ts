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

/**
 * BETREIBER-BEFUND 2026-08-11: In den fr/en/cs-Newslettern zeigten die
 * Glossar-Links auf das DEUTSCHE Lexikon — im Web dagegen korrekt aufs
 * englische.
 *
 * Begriffserklärungen gibt es nur auf Deutsch und Englisch
 * (SUPPORTED_GLOSSARY_LANGS = ['en']). Das Web löst das seit Commit d8baf9d mit
 * `lang === 'de' ? 'de' : 'en'` (lib/tiptap/glossary-link-mark.ts:50); im
 * Newsletter fehlte dieselbe Regel. Ein französischer Artikel darf weder auf
 * /de/ (falsche Sprache) noch auf /fr/glossary (existiert nicht) zeigen.
 */
describe('convertTiptapToHtml — Glossar-Sprache', () => {
  function docWithGlossaryMark(slug: string) {
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Begriff', marks: [{ type: 'glossaryLink', attrs: { slug } }] },
          ],
        },
      ],
    }
  }

  it('verlinkt im deutschen Newsletter auf /de/glossary', () => {
    const html = convertTiptapToHtml(docWithGlossaryMark('kontextfenster'), 'de')
    expect(html).toContain('/de/glossary/kontextfenster')
  })

  it('verlinkt im englischen Newsletter auf /en/glossary', () => {
    const html = convertTiptapToHtml(docWithGlossaryMark('kontextfenster'), 'en')
    expect(html).toContain('/en/glossary/kontextfenster')
    expect(html).not.toContain('/de/glossary/')
  })

  it('verlinkt im franzoesischen Newsletter auf /en/glossary, nicht /fr', () => {
    const html = convertTiptapToHtml(docWithGlossaryMark('kontextfenster'), 'fr')
    expect(html).toContain('/en/glossary/kontextfenster')
    expect(html).not.toContain('/fr/glossary/')
    expect(html).not.toContain('/de/glossary/')
  })

  it('verlinkt im tschechischen Newsletter auf /en/glossary', () => {
    const html = convertTiptapToHtml(docWithGlossaryMark('kontextfenster'), 'cs')
    expect(html).toContain('/en/glossary/kontextfenster')
    expect(html).not.toContain('/cs/glossary/')
  })

  it('schreibt einen relativen /de/glossary-Link in der Uebersetzung um', () => {
    // Relative Links tragen ihr Sprachpraefix aus dem deutschen Original mit —
    // absolut gemacht zeigten sie sonst sauber auf die falsche Sprache.
    const html = convertTiptapToHtml(docWithLink('/de/glossary/kontextfenster'), 'en')
    expect(html).toContain('https://www.synthszr.com/en/glossary/kontextfenster')
    expect(html).not.toContain('/de/glossary/')
  })

  it('fasst andere relative Pfade sprachlich nicht an', () => {
    // Nur Glossar-Pfade werden umgeschrieben: ein Artikel-Link hat seine eigene
    // Uebersetzung unter demselben Praefix und darf nicht verbogen werden.
    const html = convertTiptapToHtml(docWithLink('/en/posts/mein-artikel'), 'en')
    expect(html).toContain('https://www.synthszr.com/en/posts/mein-artikel')
  })
})
