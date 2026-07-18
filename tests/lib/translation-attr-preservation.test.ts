import { describe, it, expect, vi } from 'vitest'

// translateContent() sends the WHOLE TipTap JSON to an LLM as a serialized
// text prompt ("Maintain the EXACT same TipTap JSON structure — only
// translate text content") and parses whatever JSON comes back. That's a
// prompt-level *request*, not a code-level guarantee: there is no
// deterministic node-by-node round trip in our own code for the actual
// translation step, so a real LLM can (and in practice does) drop custom,
// non-standard TipTap attrs like `bundleType` (renders as `data-bundle-type`,
// see lib/tiptap/heading-with-queue-id.ts) when it "cleans up" the JSON it
// re-emits.
//
// To characterize this deterministically we mock the Anthropic SDK layer
// (same approach as tests/lib/article-jobs-batch.test.ts) and simulate the
// worst case: the mocked LLM response drops `bundleType` off the heading
// even though the system prompt asked it not to. This proves whether
// lib/i18n/translation-service.ts compensates for that in code.

let mockResponseText = ''

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: async () => ({
        content: [{ type: 'text', text: mockResponseText }],
      }),
    }
  }
  return { default: MockAnthropic }
})

import { translateContent } from '@/lib/i18n/translation-service'

function headingsOf(content: Record<string, unknown>) {
  return (content.content as Array<{ type: string; attrs?: Record<string, unknown> }>).filter(
    (n) => n.type === 'heading'
  )
}

describe('translateContent — bundleType attr survives translation', () => {
  it('restores bundleType when the translation LLM drops it from the JSON it returns', async () => {
    // Simulate an LLM that translated the text but dropped the custom attr.
    mockResponseText = JSON.stringify({
      title: 'Translated Title',
      slug: 'translated-title',
      excerpt: 'Translated excerpt',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Translated Heading' }] },
        ],
      },
    })

    const result = await translateContent(
      {
        title: 'Original Title',
        excerpt: 'Original excerpt',
        content: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 2, bundleType: 'topic' },
              content: [{ type: 'text', text: 'Original Heading' }],
            },
          ],
        },
      },
      'en',
      'claude-haiku-3.5'
    )

    expect(result.success).toBe(true)
    const headings = headingsOf(result.content!)
    expect(headings).toHaveLength(1)
    expect(headings[0].attrs?.bundleType).toBe('topic')
  })

  it('matches by heading ordinal: only restores bundleType where the source had it', async () => {
    // 3 headings; source has bundleType only on #1 (topic) and #3 (recap).
    // LLM response has 3 headings, none carrying bundleType.
    mockResponseText = JSON.stringify({
      title: 'T',
      slug: 't',
      excerpt: 'E',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H1' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'p' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H2' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H3' }] },
        ],
      },
    })

    const result = await translateContent(
      {
        title: 'T',
        excerpt: 'E',
        content: {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2, bundleType: 'topic' }, content: [{ type: 'text', text: 'H1' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'p' }] },
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H2' }] },
            { type: 'heading', attrs: { level: 2, bundleType: 'recap' }, content: [{ type: 'text', text: 'H3' }] },
          ],
        },
      },
      'en',
      'claude-haiku-3.5'
    )

    expect(result.success).toBe(true)
    const headings = headingsOf(result.content!)
    expect(headings).toHaveLength(3)
    expect(headings[0].attrs?.bundleType).toBe('topic')
    expect(headings[1].attrs?.bundleType).toBeFalsy()
    expect(headings[2].attrs?.bundleType).toBe('recap')
  })

  it('leaves an already-preserved bundleType untouched (no double-processing artifacts)', async () => {
    mockResponseText = JSON.stringify({
      title: 'Translated Title',
      slug: 'translated-title',
      excerpt: 'Translated excerpt',
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2, bundleType: 'topic' },
            content: [{ type: 'text', text: 'Translated Heading' }],
          },
        ],
      },
    })

    const result = await translateContent(
      {
        title: 'Original Title',
        excerpt: 'Original excerpt',
        content: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 2, bundleType: 'topic' },
              content: [{ type: 'text', text: 'Original Heading' }],
            },
          ],
        },
      },
      'en',
      'claude-haiku-3.5'
    )

    expect(result.success).toBe(true)
    const headings = headingsOf(result.content!)
    expect(headings[0].attrs?.bundleType).toBe('topic')
  })
})
