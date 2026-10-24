/**
 * Marker „Synthszr Update:" im Newsletter-HTML (Spec 2026-10-24).
 *
 * Dieselbe Darstellung wie der Take: gelbes Label und Vote-Links. Die E-Mail
 * erkennt Takes ueber mehrere Regexe (Take|Contra) — jede davon muss das
 * Update kennen, sonst faellt es in der Mail als normaler Absatz durch.
 */
import { describe, expect, it } from 'vitest'
import { convertTiptapToHtml, generateEmailContentWithVotes, type TiptapDoc } from '@/lib/email/tiptap-to-html'

const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2, queueItemId: 'q1' }, content: [{ type: 'text', text: 'Montag — X' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Bericht.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Synthszr Update: Neu und belegt.' }] },
  ],
} as unknown as TiptapDoc

describe('Newsletter — Synthszr Update', () => {
  it('stylt das Update-Label gelb wie den Take', () => {
    expect(convertTiptapToHtml(doc)).toMatch(/<strong style="background-color: #FFFF00[^"]*">Synthszr Update:<\/strong>/)
  })

  it('haengt die Vote-Links an das Update', async () => {
    const html = await generateEmailContentWithVotes({ content: doc, slug: 's' }, 'https://www.synthszr.com')
    expect(html).toContain('/api/newsletter-vote?v=agree')
  })

  it('escapt Anfuehrungszeichen im href — Quellen-URLs kommen jetzt aus der Web-Suche', () => {
    // Review 2026-10-24: sanitizeUrl gibt eine nicht parsebare URL roh zurueck;
    // ein Anfuehrungszeichen darin braeche das href-Attribut im Newsletter auf.
    const mitLink = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Update-Quellen: ' }, {
        type: 'text', text: 'Q',
        marks: [{ type: 'link', attrs: { href: 'https://exa mple.com/x"onmouseover="1' } }],
      }] },
    ] } as unknown as TiptapDoc
    const html = convertTiptapToHtml(mitLink)
    expect(html).not.toContain('x"onmouseover="1"')
    expect(html).toContain('&quot;')
  })
})
