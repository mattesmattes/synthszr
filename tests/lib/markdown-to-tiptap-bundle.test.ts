import { describe, expect, it } from 'vitest'
import { extractBundleMarkers, applyBundleMarkers } from '@/lib/utils/markdown-to-tiptap'

describe('extractBundleMarkers', () => {
  it('strips the marker from the heading line and records its ordinal + type', () => {
    const md = '## Foo <!-- data-bundle-type:topic -->\n\ntext\n\n## Bar\n\nmore\n\n## Baz <!-- data-bundle-type:recap -->'
    const { cleaned, markers } = extractBundleMarkers(md)
    expect(cleaned).not.toContain('data-bundle-type')
    expect(cleaned).toContain('## Foo')
    expect(cleaned).toContain('## Baz')
    expect(markers).toEqual([
      { headingIndex: 0, bundleType: 'topic' },
      { headingIndex: 2, bundleType: 'recap' },
    ])
  })

  it('leaves markdown without markers untouched (no headings mutated)', () => {
    const md = '## Normal heading\n\ntext'
    const { cleaned, markers } = extractBundleMarkers(md)
    expect(cleaned).toBe(md)
    expect(markers).toEqual([])
  })
})

describe('applyBundleMarkers', () => {
  it('sets bundleType attr on the Nth heading node, leaves others untouched', () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Foo' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Bar' }] },
      ],
    }
    applyBundleMarkers(json, [{ headingIndex: 1, bundleType: 'recap' }])
    const headings = (json.content as Array<{ type: string; attrs?: Record<string, unknown> }>).filter((n) => n.type === 'heading')
    expect(headings[0].attrs?.bundleType).toBeUndefined()
    expect(headings[1].attrs?.bundleType).toBe('recap')
  })
})

// markdownToTiptap() itself calls @tiptap/core's generateJSON(), which hard-
// requires a `window` object (elementFromString) — it only runs in a browser
// or jsdom-with-window context, never under vitest's `environment: 'node'`
// (same reason lib/article-jobs/service.ts built a separate jsdom+prosemirror
// markdownToTiptapServer() for cron/server contexts — see the comment there).
// That's a pre-existing constraint of the function, not something this task
// changes. We prove the round trip the same way the production pipeline
// actually exercises it: marked → jsdom DOM → prosemirror DOMParser (the
// exact machinery markdownToTiptapServer uses), using the SAME shared
// extractBundleMarkers/applyBundleMarkers helpers markdownToTiptap calls.
describe('data-bundle-type round trip (jsdom + prosemirror, mirrors markdownToTiptapServer)', () => {
  it('converts the marker into a bundleType heading attribute and strips it from visible text', async () => {
    const { marked } = await import('marked')
    const { getSchema } = await import('@tiptap/core')
    const { DOMParser: PMDOMParser } = await import('@tiptap/pm/model')
    const StarterKit = (await import('@tiptap/starter-kit')).default
    const Link = (await import('@tiptap/extension-link')).default
    const { HeadingWithQueueId } = await import('@/lib/tiptap/heading-with-queue-id')
    const { JSDOM } = await import('jsdom')

    const md = '## Thema-Bündel <!-- data-bundle-type:topic -->\n\nInhalt.\n\n## Normale Überschrift\n\nmehr Inhalt.'
    const { cleaned, markers } = extractBundleMarkers(md)
    const html = marked.parse(cleaned, { async: false }) as string
    const schema = getSchema([
      StarterKit.configure({ heading: false }),
      HeadingWithQueueId.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      Link.configure({ openOnClick: false }),
    ])
    const dom = new JSDOM(`<body>${html}</body>`)
    const json = PMDOMParser.fromSchema(schema).parse(dom.window.document.body).toJSON() as {
      content: Array<{ type: string; attrs?: Record<string, unknown>; content?: Array<{ text?: string }> }>
    }
    applyBundleMarkers(json, markers)

    const headings = json.content.filter((n) => n.type === 'heading')
    expect(headings).toHaveLength(2)
    expect(headings[0].attrs?.bundleType).toBe('topic')
    expect(headings[0].content?.map((t) => t.text).join('')).not.toContain('data-bundle-type')
    expect(headings[1].attrs?.bundleType).toBeFalsy()
  })
})
