import { describe, it, expect } from 'vitest'
import { renderStaticArticleHtml } from '@/lib/tiptap/render-static-html'

const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Testüberschrift' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Ein Absatz über {Palantir} und KI.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Link: ', }, { type: 'text', text: 'Quelle', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] },
  ],
}

describe('renderStaticArticleHtml', () => {
  it('rendert Headings, Absätze und Links als HTML', () => {
    const html = renderStaticArticleHtml(doc)
    expect(html).toContain('<h2')
    expect(html).toContain('Testüberschrift')
    expect(html).toContain('href="https://example.com"')
  })

  it('entfernt {Company}-Direktiven-Tags aus dem Text', () => {
    const html = renderStaticArticleHtml(doc)
    expect(html).not.toContain('{Palantir}')
    expect(html).toContain('und KI')
  })

  it('akzeptiert JSON-Strings und liefert bei Müll leeren String statt zu werfen', () => {
    expect(renderStaticArticleHtml(JSON.stringify(doc))).toContain('Testüberschrift')
    expect(renderStaticArticleHtml('kein json')).toBe('')
    expect(renderStaticArticleHtml({} as Record<string, unknown>)).toBe('')
  })
})
