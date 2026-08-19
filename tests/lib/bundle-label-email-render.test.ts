import { describe, expect, it } from 'vitest'
import { convertTiptapToHtml } from '@/lib/email/tiptap-to-html'

describe('convertTiptapToHtml — bundle label badge', () => {
  it('renders a label badge above a heading with bundleType, locale-aware', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, bundleType: 'topic' }, content: [{ type: 'text', text: 'Foo' }] },
      ],
    }
    const de = convertTiptapToHtml(doc)
    expect(de).toContain('Thema des Tages')
    expect(de.indexOf('Thema des Tages')).toBeLessThan(de.indexOf('<h2'))

    const en = convertTiptapToHtml(doc, 'en')
    expect(en).toContain('Topic of the Day')
  })

  it('renders the badge for bundleType "deep_dive" (Befund 2026-08-19: fehlte in der Bedingung)', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, bundleType: 'deep_dive' }, content: [{ type: 'text', text: 'Foo' }] },
      ],
    }
    const html = convertTiptapToHtml(doc)
    expect(html).toContain('Deep Dive')
    expect(html).toContain('border-radius:999px')
  })

  it('renders no badge for a heading without bundleType', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Normal' }] },
      ],
    }
    const html = convertTiptapToHtml(doc)
    expect(html).not.toContain('border-radius:999px')
  })

  it('escapes raw text content to prevent HTML/content injection', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'A < B & <script>alert(1)</script>' }] },
      ],
    }
    const html = convertTiptapToHtml(doc)
    expect(html).toContain('&lt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})
