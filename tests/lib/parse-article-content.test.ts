// tests/lib/parse-article-content.test.ts — Heading-Marker raus aus dem Excerpt.
// BEFUND 2026-10-06: Ab Task 9 trägt JEDE H2-Zeile des Pipeline-Markdowns
// `<!-- data-queue-item-ids:… -->` (Bündel zusätzlich `<!-- data-bundle-type:… -->`).
// parseArticleContent füllt das Excerpt aus den rohen H2-Zeilen auf, sobald das
// LLM weniger als 3 Bullets liefert; ohne Bereinigung landete der Kommentar —
// nach dem 65-Zeichen-Schnitt oft ungeschlossen — im Excerpt und damit in
// Meta-Description, JSON-LD und RSS-Feed des Posts.
import { describe, expect, it } from 'vitest'
import { parseArticleContent, stripHtmlComments } from '@/lib/utils/parse-article-content'

const ID1 = '3f2a1b4c-1111-2222-3333-444455556666'
const ID2 = '9e8d7c6b-5555-6666-7777-888899990000'

describe('stripHtmlComments', () => {
  it('entfernt Heading-Marker samt Leerzeichen davor und lässt übriges Markdown/HTML unverändert', () => {
    const md = `## Eins <!-- data-queue-item-ids:${ID1},${ID2} --> <!-- data-bundle-type:topic -->\n\nText mit <b>fett</b>.`
    expect(stripHtmlComments(md)).toBe('## Eins\n\nText mit <b>fett</b>.')
  })

  it('lässt Zeilenumbrüche stehen: eine eigenständige Kommentarzeile verschmilzt keine Absätze', () => {
    // Prüferlauf 2026-10-06: Mit `\s*` vor dem Kommentar wurde aus
    // "Absatz eins.\n\n<!-- … -->\nAbsatz zwei." ein einziger Absatz
    // ("Absatz eins.\nAbsatz zwei."), weil die Leerzeile mitgefressen wurde.
    // Eigenständige Kommentarzeilen sind nicht hypothetisch (saveAsDraft in
    // create-article/page.tsx:668-669 rechnete schon mit `<!-- category: … -->`-
    // Zeilen). Ein allgemeiner Bereinigungs-Helfer darf deshalb keine
    // Absatzgrenze (`\n\n`) zerstören.
    const md = 'Absatz eins.\n\n<!-- category: AI & Tech -->\nAbsatz zwei.'
    expect(stripHtmlComments(md)).toBe('Absatz eins.\n\n\nAbsatz zwei.')
  })
})

describe('parseArticleContent — Excerpt-Auffüllung aus H2-Titeln', () => {
  it('füllt fehlende Bullets mit H2-Titeln OHNE HTML-Kommentare auf', () => {
    const md = [
      '---',
      'TITLE: Titel',
      'EXCERPT:',
      '• a',
      'CATEGORY: AI & Tech',
      '---',
      '',
      `## Heading eins <!-- data-queue-item-ids:${ID1} -->`,
      '',
      'Text eins.',
      '',
      `## Heading zwei <!-- data-queue-item-ids:${ID1},${ID2} --> <!-- data-bundle-type:topic -->`,
      '',
      'Text zwei.',
      '',
    ].join('\n')
    const { metadata, body } = parseArticleContent(md)
    expect(metadata.excerpt).toBe('• a\n• Heading eins\n• Heading zwei')
    // Der Body bleibt unangetastet — die Marker braucht der Konverter (Task 7).
    expect(body).toContain(`## Heading eins <!-- data-queue-item-ids:${ID1} -->`)
  })
})
