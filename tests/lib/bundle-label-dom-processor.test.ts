import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { processBundleLabels } from '@/lib/tiptap/dom-processors/bundle-label'

describe('processBundleLabels', () => {
  let dom: JSDOM
  const originalDocument = globalThis.document

  beforeEach(() => {
    dom = new JSDOM('<div id="c"><h2 data-bundle-type="topic">Foo</h2><p>text</p><h2>Normal</h2></div>')
    ;(globalThis as unknown as { document: Document }).document = dom.window.document as unknown as Document
  })

  afterEach(() => {
    ;(globalThis as unknown as { document: Document }).document = originalDocument
  })

  it('inserts a locale-aware badge before a bundled H2, leaves plain H2 untouched', () => {
    const container = dom.window.document.getElementById('c') as unknown as HTMLElement
    processBundleLabels(container, 'en')

    const badge = container.querySelector('.bundle-label-badge')
    expect(badge?.textContent).toBe('Topic of the Day')
    expect(badge?.nextElementSibling?.tagName).toBe('H2')

    const headings = container.querySelectorAll('h2')
    expect(headings).toHaveLength(2)
    expect(headings[1].previousElementSibling?.classList.contains('bundle-label-badge')).toBe(false)
  })

  it('is idempotent — a second pass does not insert a duplicate badge', () => {
    const container = dom.window.document.getElementById('c') as unknown as HTMLElement
    processBundleLabels(container, 'en')
    processBundleLabels(container, 'en')

    expect(container.querySelectorAll('.bundle-label-badge')).toHaveLength(1)
  })
})
