/**
 * `{lex:…}`-Direktiven im Newsletter.
 *
 * BETREIBER-BEFUND 2026-08-13: Im Newsletter stand „{lex:Supervised
 * Fine-Tuning}" im Klartext, während dieselbe Stelle im Web sauber verlinkt war.
 * Beides hat DIESELBE Ursache: Sobald die Mark-Injektion den Begriff verlinkt
 * hat, zerfällt der Tag in drei Textknoten — `{lex:` · Begriff (mit
 * glossaryLink-Mark) · `}`. Die Regex des Newsletters sucht den Tag am Stück
 * und findet ihn dann nicht mehr.
 *
 * An zehn Artikeln gemessen: 10 Tags standen in einem Knoten (korrekt
 * entfernt), 57 waren verteilt — der Fehlerfall war also der Regelfall.
 */
import { describe, expect, it } from 'vitest'
import { convertTiptapToHtml } from '@/lib/email/tiptap-to-html'

/** So sieht ein Tag aus, NACHDEM die Mark-Injektion den Begriff verlinkt hat. */
function docMitVerteiltemTag() {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Das Verfahren heißt {lex:' },
          {
            type: 'text',
            text: 'Supervised Fine-Tuning',
            marks: [{ type: 'glossaryLink', attrs: { slug: 'supervised-fine-tuning' } }],
          },
          { type: 'text', text: '} und kostet Rechenzeit.' },
        ],
      },
    ],
  }
}

describe('Newsletter — {lex:}-Direktiven', () => {
  it('entfernt die Klammern eines VERTEILTEN Tags, behaelt den Begriff', () => {
    const html = convertTiptapToHtml(docMitVerteiltemTag())
    expect(html).not.toContain('{lex:')
    expect(html).not.toContain('}')
    expect(html).toContain('Supervised Fine-Tuning')
  })

  it('laesst die Wortabstaende an den Knotengrenzen unangetastet', () => {
    // Im Web entstanden hier einmal „Sandboxund" und „eingestuftesBenchmarking",
    // weil ein trim/Whitespace-Kollaps das Grenz-Leerzeichen verschluckte.
    const html = convertTiptapToHtml(docMitVerteiltemTag())
    // Der Begriff steht im Link, deshalb auf die Grenzen pruefen statt auf
    // den durchgehenden Satz.
    expect(html).toContain('heißt <a ')
    expect(html).toContain('</a> und kostet Rechenzeit.')
  })

  it('entfernt weiterhin einen Tag, der ganz in EINEM Knoten steht', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Ein {lex:Foundation Model} im Satz.' }],
      }],
    }
    const html = convertTiptapToHtml(doc)
    expect(html).not.toContain('{lex:')
    expect(html).toContain('Ein Foundation Model im Satz.')
  })

  it('frisst keine schliessende Klammer ohne ausstehendes {lex:', () => {
    // Der Zustandsautomat darf nur DIE Klammer entfernen, deren `{lex:` er
    // selbst geschluckt hat. Sonst verschwaende er fremde Zeichen.
    // (Das generische {…}-Strip fuer {Company}-Tags ist aelter und hier nicht
    // Gegenstand — es entfernt vollstaendige Klammerpaare bewusst.)
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ergebnis } Ende.' }] }],
    }
    expect(convertTiptapToHtml(doc)).toContain('Ergebnis } Ende.')
  })

  it('kommt mit mehreren verteilten Tags nacheinander klar', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Erst {lex:' },
          { type: 'text', text: 'Inferenz', marks: [{ type: 'glossaryLink', attrs: { slug: 'inferenz' } }] },
          { type: 'text', text: '}, dann {lex:' },
          { type: 'text', text: 'Token', marks: [{ type: 'glossaryLink', attrs: { slug: 'token' } }] },
          { type: 'text', text: '} zum Schluss.' },
        ],
      }],
    }
    const html = convertTiptapToHtml(doc)
    expect(html).not.toContain('{lex:')
    expect(html).toContain('Inferenz')
    expect(html).toContain('Token')
    expect(html).not.toMatch(/\}\s*,/)
  })
})
