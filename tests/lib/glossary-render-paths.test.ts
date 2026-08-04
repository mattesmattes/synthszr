import { describe, expect, it } from 'vitest'
import { renderStaticArticleHtml } from '@/lib/tiptap/render-static-html'
import { convertTiptapToHtml } from '@/lib/email/tiptap-to-html'
import { SITE_URL } from '@/lib/seo/site'

const withGlossary = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Die ' },
      { type: 'text', text: 'Inferenz', marks: [{ type: 'glossaryLink', attrs: { slug: 'inferenz' } }] },
      { type: 'text', text: ' ist teuer.' },
    ],
  }],
}

describe('render-static-html mit glossaryLink', () => {
  it('rendert den Link im ausgelieferten HTML', () => {
    const html = renderStaticArticleHtml(withGlossary)
    expect(html).toContain('/glossary/inferenz')
    expect(html).toContain('Inferenz')
  })

  it('verliert den umgebenden Text nicht', () => {
    const html = renderStaticArticleHtml(withGlossary)
    expect(html).toContain('ist teuer')
  })

  it('entfernt {lex:}-Direktiven', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ein {lex:Inferenz}-Problem.' }] }],
    }
    const html = renderStaticArticleHtml(doc)
    expect(html).not.toContain('{lex:')
    expect(html).toContain('Inferenz')
  })

  it('rendert einen Artikel ohne Glossarbegriffe unverändert', () => {
    const plain = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nur Text.' }] }],
    }
    expect(renderStaticArticleHtml(plain)).toContain('Nur Text.')
  })

  it('verwendet die übergebene Sprache im href statt des de-Defaults', () => {
    const html = renderStaticArticleHtml(withGlossary, 'en')
    expect(html).toContain('/en/glossary/inferenz')
    expect(html).not.toContain('/de/glossary/inferenz')
  })

  it('fällt ohne Sprachparameter auf de zurück', () => {
    const html = renderStaticArticleHtml(withGlossary)
    expect(html).toContain('/de/glossary/inferenz')
  })
})

describe('tiptap-to-html (E-Mail) mit glossaryLink', () => {
  it('rendert den Link in einem normalen Absatz (renderContent-Pfad)', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Die ' },
          { type: 'text', text: 'Inferenz', marks: [{ type: 'glossaryLink', attrs: { slug: 'inferenz' } }] },
          { type: 'text', text: ' ist teuer.' },
        ],
      }],
    }
    const html = convertTiptapToHtml(doc)
    expect(html).toContain(`${SITE_URL}/de/glossary/inferenz`)
    expect(html).toContain('Inferenz')
    expect(html).toContain('ist teuer')
  })

  it('rendert den Link in einem Synthszr-Take-Absatz (applyMarks-Pfad)', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Synthszr Take: Die ', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'Inferenz', marks: [{ type: 'glossaryLink', attrs: { slug: 'inferenz' } }] },
          { type: 'text', text: ' ist teuer.' },
        ],
      }],
    }
    const html = convertTiptapToHtml(doc)
    expect(html).toContain(`${SITE_URL}/de/glossary/inferenz`)
    expect(html).toContain('Inferenz')
  })

  it('verwendet die übergebene Sprache im href statt des de-Defaults', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Inferenz', marks: [{ type: 'glossaryLink', attrs: { slug: 'inferenz' } }] }],
      }],
    }
    const html = convertTiptapToHtml(doc, 'en')
    expect(html).toContain(`${SITE_URL}/en/glossary/inferenz`)
    expect(html).not.toContain('/de/glossary/inferenz')
  })

  it('erbt die Textfarbe, statt wie ein gewöhnlicher Link zu färben', () => {
    // Ersetzt einen Test, der bis 2026-08-04 das GEGENTEIL fixierte ("rendert
    // kein style-Attribut, wie der bestehende link-Fall"). Damals stimmte das:
    // ohne Auszeichnung war ein Begriffs-Link ein nackter <a>. Mit der
    // Entscheidung für die gepunktete Unterstreichung braucht die E-Mail einen
    // Inline-Stil — dort gibt es kein Stylesheet, das die Klasse aufgreifen
    // könnte. Geprüft bleibt die Eigenschaft, die den Sinn trägt: der Begriff
    // bleibt Teil des Satzes und wird nicht zum blauen Link.
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Inferenz', marks: [{ type: 'glossaryLink', attrs: { slug: 'inferenz' } }] }],
      }],
    }
    const html = convertTiptapToHtml(doc)
    expect(html).toContain('color: inherit')
    expect(html).not.toMatch(/color:\s*#?(0000ff|blue|1a0dab)/i)
  })

  it('entfernt {lex:}-Direktiven', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ein {lex:Inferenz}-Problem.' }] }],
    }
    const html = convertTiptapToHtml(doc)
    expect(html).not.toContain('{lex:')
    expect(html).toContain('Inferenz')
  })

  it('rendert einen Artikel ohne Glossarbegriffe unverändert', () => {
    const plain = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nur Text.' }] }],
    }
    expect(convertTiptapToHtml(plain)).toContain('Nur Text.')
  })

  it('verlinkt Glossarbegriffe im normalen Absatz UND im Synthszr-Take-Absatz', () => {
    // Zwei getrennte Renderpfade in tiptap-to-html.ts: normale Knoten laufen
    // über den switch in renderContent, "Synthszr Take/Contra"-Absätze über
    // applyMarks. Beide müssen die Mark kennen — sonst fehlen die Links genau
    // dort, wo die meisten Absätze sind.
    const link = { type: 'glossaryLink', attrs: { slug: 'inferenz' } }
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Inferenz', marks: [link] },
            { type: 'text', text: ' ist teuer.' },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Synthszr Take: ', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'Inferenz', marks: [link] },
            { type: 'text', text: ' bleibt der Kostentreiber.' },
          ],
        },
      ],
    }
    const html = convertTiptapToHtml(doc, 'en')
    const hits = html.match(/\/en\/glossary\/inferenz/g) ?? []
    expect(hits).toHaveLength(2) // einmal pro Pfad
    expect(html).toContain(SITE_URL)
  })
})

describe('tiptap-to-markdown (GET /api/posts/[slug]/markdown) mit {lex:}', () => {
  // Dritter {…}-Strip-Pfad im Repo neben render-static-html.ts und
  // tiptap-to-html.ts (siehe die beiden describe-Blöcke oben) — dieser hier
  // fehlte in dieser Testdatei, obwohl die anderen zwei Pfade hier stehen.
  // Genau das war der strukturelle Grund, warum die fehlende Erweiterung für
  // {lex:} hier durchgefallen ist (Abschluss-Review, Befund A). Speist den
  // öffentlichen, unauthentifizierten Endpunkt GET /api/posts/[slug]/markdown.
  it('entfernt {lex:}-Direktiven, behält aber den Begriff (nicht preserveCompanyTags)', async () => {
    const { convertTiptapToMarkdown } = await import('@/lib/utils/tiptap-to-markdown')
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ein {lex:Mixture of Experts}-Modell skaliert billiger.' }] }],
    }
    const markdown = convertTiptapToMarkdown(doc)
    expect(markdown).not.toContain('{lex:')
    expect(markdown).toContain('Mixture of Experts')
  })

  it('behält {lex:}-Direktiven verbatim, wenn preserveCompanyTags gesetzt ist (EIC-Re-Run-Pfad)', async () => {
    // preserveCompanyTags ist für den Editor-in-Chief-Re-Run-Roundtrip
    // (tiptap → markdown → LLM → markdown → tiptap) gedacht — der Tag muss
    // dafür unangetastet bleiben, sonst geht die Struktur-Markierung für den
    // nächsten Tiptap-Import verloren. Nur der Public-Markdown-Pfad (ohne
    // preserveCompanyTags) muss den Tag auflösen.
    const { convertTiptapToMarkdown } = await import('@/lib/utils/tiptap-to-markdown')
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ein {lex:Mixture of Experts}-Modell.' }] }],
    }
    const markdown = convertTiptapToMarkdown(doc, { preserveCompanyTags: true })
    expect(markdown).toContain('{lex:Mixture of Experts}')
  })
})

/**
 * Auszeichnung der Begriffs-Links (Design-Entscheidung 2026-08-04): gepunktete
 * Unterstreichung, die Lexikon-Konvention. Sie muss sich von zwei bereits
 * belegten Signalen unterscheiden — durchgezogene Unterstreichung markiert
 * Chart-Produkte, cyan Hintergrund den Synthszr Take.
 *
 * Im Web trägt die Mark die Klasse .glossary-link (globals.css). In der E-Mail
 * gibt es kein Stylesheet, dort MUSS der Stil inline stehen, sonst ist ein
 * Begriffs-Link von einem Quellen-Link nicht zu unterscheiden.
 */
describe('glossaryLink — Auszeichnung', () => {
  const doc = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text: 'Inferenz', marks: [{ type: 'glossaryLink', attrs: { slug: 'inferenz' } }] }],
    }],
  }

  it('zeichnet den Link in der E-Mail inline gepunktet aus', () => {
    const html = convertTiptapToHtml(doc)
    expect(html).toMatch(/underline\s+dotted|border-bottom:\s*1px\s+dotted/)
  })

  it('nutzt im Web die Klasse glossary-link statt Inline-Styles', () => {
    // Im Web kommt der Stil aus globals.css — die Klasse ist der Anknüpfpunkt,
    // ohne sie greift die CSS-Regel nicht.
    const html = renderStaticArticleHtml(doc as never, 'de')
    expect(html).toContain('glossary-link')
  })
})
