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

  it('rendert keinen style-Attribut (wie der bestehende link-Fall)', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Inferenz', marks: [{ type: 'glossaryLink', attrs: { slug: 'inferenz' } }] }],
      }],
    }
    const html = convertTiptapToHtml(doc)
    expect(html).toMatch(/<a href="[^"]+">Inferenz<\/a>/)
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
})
