/**
 * HeadingWithQueueId: alle fuenf Heading-Attribute muessen im ProseMirror-
 * Schema deklariert sein — undeklarierte attrs fallen beim ersten Editor-Save
 * (editor.getJSON()) und beim HTML-Parse stillschweigend weg (BEFUND 2026-10-06).
 *
 * Geprueft ueber den echten Schema-Roundtrip (jsdom + prosemirror DOMParser/
 * DOMSerializer — dieselbe Maschinerie wie markdownToTiptapServer und der
 * Editor), nicht ueber HeadingWithQueueId.config.addAttributes(): das ist
 * zwar eine Funktion, braucht aber das von TipTap gebundene `this.parent`.
 */
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser, DOMSerializer } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { JSDOM } from 'jsdom'
import { HeadingWithQueueId } from '@/lib/tiptap/heading-with-queue-id'

const schema = getSchema([
  StarterKit.configure({ heading: false }),
  HeadingWithQueueId.configure({ levels: [1, 2, 3, 4, 5, 6] }),
])
const dom = new JSDOM('<body></body>')

function parseAttrs(html: string): Record<string, unknown> {
  const body = dom.window.document.createElement('body')
  body.innerHTML = html
  const json = PMDOMParser.fromSchema(schema).parse(body).toJSON() as {
    content: Array<{ attrs?: Record<string, unknown> }>
  }
  return json.content[0].attrs ?? {}
}

function renderHeading(attrs: Record<string, unknown>): string {
  const node = schema.nodeFromJSON({ type: 'heading', attrs, content: [{ type: 'text', text: 'Foo' }] })
  const el = DOMSerializer.fromSchema(schema).serializeNode(node, { document: dom.window.document }) as HTMLElement
  return el.outerHTML
}

describe('HeadingWithQueueId', () => {
  it('liest alle fuenf data-Attribute aus dem HTML (parseHTML)', () => {
    const attrs = parseAttrs(
      '<h2 data-queue-item-id="q1" data-bundle-type="topic" data-queue-item-ids="q1,q2" data-curation-rank="3" data-curation-tier="bench">Foo</h2>',
    )
    expect(attrs).toEqual({
      level: 2,
      queueItemId: 'q1',
      bundleType: 'topic',
      queueItemIds: 'q1,q2',
      curationRank: '3',
      curationTier: 'bench',
    })
  })

  it('schreibt alle fuenf Attribute als data-Attribute ins HTML (renderHTML)', () => {
    const html = renderHeading({
      level: 2, queueItemId: 'q1', bundleType: 'topic', queueItemIds: 'q1,q2', curationRank: '3', curationTier: 'bench',
    })
    expect(html).toBe(
      '<h2 data-queue-item-id="q1" data-bundle-type="topic" data-queue-item-ids="q1,q2" data-curation-rank="3" data-curation-tier="bench">Foo</h2>',
    )
  })

  it('rendert ohne gesetzte Attribute ein nacktes h2', () => {
    expect(renderHeading({ level: 2 })).toBe('<h2>Foo</h2>')
  })
})
