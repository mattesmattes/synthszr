import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { processNewsHeadings, type ArticleThumbnail } from '@/lib/tiptap/dom-processors/news-headings'
import { processBundleLabels } from '@/lib/tiptap/dom-processors/bundle-label'

// Reproduziert das reale Renderer-Timing: processContent() läuft mehrfach.
// Beim ERSTEN Durchgang sind die Thumbnails noch nicht gefetcht, das
// Bündel-Badge wird also vor der H2 eingefügt. Beim ZWEITEN Durchgang kommt
// der Thumbnail dazu. Die finale DOM-Reihenfolge MUSS [Thumbnail][Badge][H2]
// sein — nicht [Badge][Thumbnail][H2].
describe('news-heading + bundle-label ordering (async thumbnails)', () => {
  let dom: JSDOM
  const originalDocument = globalThis.document
  const originalNode = (globalThis as unknown as { Node?: unknown }).Node

  const thumb: ArticleThumbnail = {
    id: 't1',
    article_index: 0,
    article_queue_item_id: 'q1',
    image_url: 'https://example.com/x.png',
    vote_color: '#ccff00',
    generation_status: 'completed',
  }

  beforeEach(() => {
    dom = new JSDOM('<div id="c"><h2 data-queue-item-id="q1" data-bundle-type="topic">Foo</h2><p>Text</p></div>', { url: 'https://synthszr.com' })
    ;(globalThis as unknown as { document: Document }).document = dom.window.document as unknown as Document
    ;(globalThis as unknown as { Node: unknown }).Node = dom.window.Node
  })

  afterEach(() => {
    ;(globalThis as unknown as { document: Document }).document = originalDocument
    ;(globalThis as unknown as { Node: unknown }).Node = originalNode
  })

  it('places the thumbnail above the badge even when the badge was inserted first', () => {
    const container = dom.window.document.getElementById('c') as unknown as HTMLElement

    // 1. Durchgang: Thumbnails noch nicht geladen → nur das Badge landet vor der H2.
    processNewsHeadings(container, [], ['q1'])
    processBundleLabels(container, 'de')

    // 2. Durchgang: Thumbnails da → Thumbnail-Container wird eingefügt, Badge bleibt (idempotent).
    processNewsHeadings(container, [thumb], ['q1'])
    processBundleLabels(container, 'de')

    const thumbnailContainer = container.querySelector('.article-thumbnail-container')
    const badge = container.querySelector('.bundle-label-badge')
    const h2 = container.querySelector('h2')

    expect(thumbnailContainer).not.toBeNull()
    expect(badge).not.toBeNull()

    // Reihenfolge muss exakt [Thumbnail][Badge][H2] sein.
    expect(thumbnailContainer!.nextElementSibling).toBe(badge)
    expect(badge!.nextElementSibling).toBe(h2)
  })

  it('does not duplicate the thumbnail across passes', () => {
    const container = dom.window.document.getElementById('c') as unknown as HTMLElement
    processNewsHeadings(container, [], ['q1'])
    processBundleLabels(container, 'de')
    processNewsHeadings(container, [thumb], ['q1'])
    processNewsHeadings(container, [thumb], ['q1'])

    expect(container.querySelectorAll('.article-thumbnail-container')).toHaveLength(1)
  })
})
