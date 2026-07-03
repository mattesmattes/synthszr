import { describe, it, expect } from 'vitest'
import { findMentionedProducts, extractVisibleText } from '@/lib/posts/product-mentions'

const products = [
  { canonicalName: 'Claude Code' },
  { canonicalName: 'Gemini 3 Pro' },
  { canonicalName: 'Grok' },
  { canonicalName: 'Vim' }, // < 4 Zeichen → nie matchen
]

describe('findMentionedProducts', () => {
  it('findet Produktnamen mit Wortgrenzen (case-insensitive)', () => {
    const text = 'Heute hat CLAUDE CODE ein Update bekommen, Gemini 3 Pro zieht nach.'
    const hits = findMentionedProducts(text, products)
    expect(hits.map((h) => h.canonicalName)).toEqual(['Claude Code', 'Gemini 3 Pro'])
  })

  it('matcht nicht innerhalb anderer Wörter', () => {
    expect(findMentionedProducts('Das Grokking-Phänomen', products)).toEqual([])
  })

  it('ignoriert zu kurze Namen und respektiert das Max-Limit', () => {
    expect(findMentionedProducts('Vim Vim Vim', products)).toEqual([])
    const many = Array.from({ length: 20 }, (_, i) => ({ canonicalName: `Produktname${i}` }))
    const text = many.map((p) => p.canonicalName).join(' ')
    expect(findMentionedProducts(text, many, 8)).toHaveLength(8)
  })
})

describe('extractVisibleText', () => {
  it('ignoriert Link-Attribute (href) und matcht nur sichtbaren Text', () => {
    const contentWithLinkOnly = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Quelle',
              marks: [{ type: 'link', attrs: { href: 'https://grok.com/blog/x' } }],
            },
          ],
        },
      ],
    }
    const visibleText = extractVisibleText(contentWithLinkOnly)
    expect(visibleText).not.toContain('grok.com')
    expect(findMentionedProducts(visibleText, products)).toEqual([])
  })

  it('matcht sichtbaren Text normal', () => {
    const contentWithVisibleMention = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Grok ist schnell' }],
        },
      ],
    }
    const visibleText = extractVisibleText(contentWithVisibleMention)
    expect(findMentionedProducts(visibleText, products).map((h) => h.canonicalName)).toEqual([
      'Grok',
    ])
  })
})
