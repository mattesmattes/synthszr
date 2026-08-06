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

  it('schickt Leser einer dritten Sprache auf die ENGLISCHE Erklärung, nicht auf ihre eigene', () => {
    // Begriffserklärungen gibt es nur auf Deutsch und Englisch
    // (SUPPORTED_GLOSSARY_LANGS = ['en']). Ein cs/nds/fr-Artikel verlinkte
    // bisher auf /cs/glossary/... — dort greift der Feld-Fallback und der Leser
    // bekommt DEUTSCHEN Text, obwohl eine englische Fassung existiert.
    // Betreiber-Entscheidung 2026-08-06: alles ausser 'de' zeigt auf 'en'.
    for (const lang of ['cs', 'nds', 'fr', 'pt', 'es']) {
      const html = generateHTML(doc('inferenz'), [StarterKit, GlossaryLinkMark.configure({ lang })])
      expect(html).toContain('/en/glossary/inferenz')
      expect(html).not.toContain(`/${lang}/glossary/`)
    }
  })

  it('fällt ohne konfigurierte Sprache auf "de" zurück', () => {
    // Bestehende Aufrufer, die noch keine Sprache übergeben, dürfen nicht
    // brechen — deshalb Default statt Pflichtoption.
    const html = generateHTML(doc('inferenz'), [StarterKit, GlossaryLinkMark])
    expect(html).toContain('/de/glossary/inferenz')
  })
})
