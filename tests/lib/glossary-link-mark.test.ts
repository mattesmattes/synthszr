import { describe, expect, it } from 'vitest'
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import { GlossaryLinkMark } from '@/lib/tiptap/glossary-link-mark'

function doc(slug: string) {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text: 'Inferenz', marks: [{ type: 'glossaryLink', attrs: { slug } }] }],
    }],
  }
}

describe('GlossaryLinkMark', () => {
  it('rendert den href mit dem konfigurierten Sprachpräfix', () => {
    const html = generateHTML(doc('inferenz'), [StarterKit, GlossaryLinkMark.configure({ lang: 'en' })])
    expect(html).toContain('/en/glossary/inferenz')
    expect(html).not.toContain('/de/glossary/')
  })

  it('fällt ohne konfigurierte Sprache auf "de" zurück', () => {
    // Bestehende Aufrufer, die noch keine Sprache übergeben, dürfen nicht
    // brechen — deshalb Default statt Pflichtoption.
    const html = generateHTML(doc('inferenz'), [StarterKit, GlossaryLinkMark])
    expect(html).toContain('/de/glossary/inferenz')
  })
})
