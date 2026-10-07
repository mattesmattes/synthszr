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

  it('gibt die Kurations-Attrs der H2 bewusst als data-Attribute aus (wie data-queue-item-id)', () => {
    // Entscheidung 2026-10-06 (Task 8): die oeffentliche Ausgabe ist gewollt —
    // s. Kopfkommentar lib/tiptap/heading-with-queue-id.ts. Faellt dieser Test,
    // wurde die Entscheidung geaendert: dann bewusst hier anpassen.
    const html = renderStaticArticleHtml({
      type: 'doc',
      content: [{
        type: 'heading',
        attrs: { level: 2, queueItemId: 'q1', bundleType: 'topic', queueItemIds: 'q1,q2', curationRank: '2', curationTier: 'recommended' },
        content: [{ type: 'text', text: 'Buendel' }],
      }],
    })
    expect(html).toContain('data-queue-item-id="q1"')
    expect(html).toContain('data-queue-item-ids="q1,q2"')
    expect(html).toContain('data-curation-rank="2"')
    expect(html).toContain('data-curation-tier="recommended"')
    expect(html).toContain('Buendel')
  })
})
