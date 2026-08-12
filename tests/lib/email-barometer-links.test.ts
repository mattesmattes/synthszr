/**
 * Take-Barometer im Newsletter (Betreiber-Wunsch 2026-08-12).
 *
 * Auf der Website ist das Barometer eine React-Komponente, die per POST mit
 * Cookie abstimmt. Eine E-Mail führt kein JavaScript aus und kann keinen
 * Origin-Header setzen — beides verlangt die reguläre Vote-Route zu Recht. In
 * der Mail sind es deshalb zwei Links auf /api/newsletter-vote.
 *
 * Der ANKER ist der kritische Teil: Er muss die queueItemId der Abschnitts-H2
 * sein, denn unter genau diesem Schlüssel zählt auch das Web-Barometer. Läge
 * dort etwas anderes, entstünden zwei getrennte Auswertungen für denselben Take.
 */
import { describe, expect, it } from 'vitest'
import { generateEmailContentWithVotes } from '@/lib/email/tiptap-to-html'

function docMitTake(opts: { queueItemId?: string | null } = {}) {
  const heading: Record<string, unknown> = {
    type: 'heading',
    attrs: opts.queueItemId === null ? { level: 2 } : { level: 2, queueItemId: opts.queueItemId ?? 'qid-123' },
    content: [{ type: 'text', text: 'Eine Nachricht' }],
  }
  return {
    type: 'doc',
    content: [
      heading,
      { type: 'paragraph', content: [{ type: 'text', text: 'Der Fließtext dazu.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Synthszr Take: So sehe ich das.' }] },
    ],
  }
}

const post = { content: docMitTake(), slug: 'mein-artikel' }

describe('Newsletter — Take-Barometer', () => {
  it('haengt zwei Vote-Links an den Take-Absatz', async () => {
    const html = await generateEmailContentWithVotes(post, 'https://www.synthszr.com')
    expect(html).toContain('/api/newsletter-vote?v=agree')
    expect(html).toContain('v=disagree')
    expect(html).toContain('👍')
    expect(html).toContain('👎')
  })

  it('nutzt die queueItemId der Abschnitts-H2 als Anker', async () => {
    const html = await generateEmailContentWithVotes(post, 'https://www.synthszr.com')
    expect(html).toContain('s=qid-123')
  })

  it('traegt den Token-Platzhalter, den der Versand ersetzt', async () => {
    const html = await generateEmailContentWithVotes(post, 'https://www.synthszr.com')
    expect(html).toContain('ct={{COMMENT_TOKEN}}')
  })

  it('zeigt KEINE Daumen ohne Anker', async () => {
    // Ohne queueItemId waere die Stimme keiner Sektion zuzuordnen — dann lieber
    // gar kein Barometer als eine Stimme im Nirgendwo.
    const ohne = { content: docMitTake({ queueItemId: null }), slug: 'mein-artikel' }
    const html = await generateEmailContentWithVotes(ohne, 'https://www.synthszr.com')
    expect(html).not.toContain('/api/newsletter-vote')
  })

  it('zeigt KEINE Daumen an gewoehnlichen Absaetzen', async () => {
    const html = await generateEmailContentWithVotes(post, 'https://www.synthszr.com')
    // Genau ein Barometer-Block, obwohl das Dokument zwei Absaetze hat.
    expect(html.match(/api\/newsletter-vote\?v=agree/g)).toHaveLength(1)
  })

  it('beschriftet englisch, wenn die Ausgabe englisch ist', async () => {
    const html = await generateEmailContentWithVotes(post, 'https://www.synthszr.com', undefined, 'en')
    expect(html).toContain('Agree')
    expect(html).toContain('l=en')
  })
})
