import { describe, expect, it } from 'vitest'
import {
  compileGlossaryMatcher,
  detectPageLanguage,
  findMatchesInText,
} from '../../extensions/synthszr-glossary/src/matcher/aho-corasick'
import {
  cleanAliasList,
  extractTipTapPlainBlocks,
  extractTipTapPlainParagraphs,
  isAmbiguousTerm,
  stripPlainText,
  type ExtensionGlossaryTerm,
} from '@/lib/glossary/extension-index'

describe('Aho-Corasick extension glossary matcher', () => {
  const sampleTerms: ExtensionGlossaryTerm[] = [
    { s: 'large-language-model', n: 'Large Language Model', a: ['LLMs'], d: 'Großes Sprachmodell.' },
    { s: 'language-model', n: 'Language Model', d: 'Statistisches Sprachmodell.' },
    { s: 'model', n: 'Model', d: 'Trainiertes Modell.', amb: 1 },
    { s: 'agent', n: 'Agent', a: ['AI Agent'], d: 'Autonomes System.', amb: 1 },
    { s: 'retrieval-augmented-generation', n: 'Retrieval-Augmented Generation', a: ['RAG'], d: 'Wissensabruf.' },
    { s: 'model-context-protocol', n: 'Model Context Protocol', a: ['MCP'], d: 'Protokoll für Tools.' },
    { s: 'sprachmodell', n: 'Sprachmodell', d: 'Deutsches Sprachmodell.' },
    { s: 'embeddings', n: 'Embeddings', a: ['Embedding'], d: 'Vektorrepräsentation.' },
    { s: 'vibe-coding', n: 'Vibe Coding', d: 'Prompt-gestützte Entwicklung.' },
  ]

  const matcher = compileGlossaryMatcher(sampleTerms)

  it('prefers the longest non-overlapping match', () => {
    const matches = findMatchesInText(matcher, 'Testing a Large Language Model in production.')
    expect(matches.map((m) => [m.term.s, m.surface])).toEqual([
      ['large-language-model', 'Large Language Model'],
    ])
  })

  it('protects German Komposita via Unicode word boundaries on both sides', () => {
    const matches = findMatchesInText(
      matcher,
      'Eine Agentur für Sprachmodellierung nutzt ein Sprachmodell und Embeddings.',
    )
    expect(matches.map((m) => m.term.s)).toEqual(['sprachmodell', 'embeddings'])
  })

  it('requires exact uppercase casing for short acronyms like RAG and MCP', () => {
    const lower = findMatchesInText(matcher, 'This old rag is useless while mcp fails.')
    expect(lower).toEqual([])

    const upper = findMatchesInText(matcher, 'We combine RAG with MCP in a Large Language Model.')
    expect(upper.map((m) => [m.term.s, m.surface, m.ambiguous])).toEqual([
      ['retrieval-augmented-generation', 'RAG', true],
      ['model-context-protocol', 'MCP', true],
      ['large-language-model', 'Large Language Model', false],
    ])
  })

  it('marks homonyms as ambiguous and keeps multi-word AI terms unambiguous', () => {
    const matches = findMatchesInText(
      matcher,
      'Der Agent nutzt das Model für Vibe Coding mit einem AI Agent.',
    )
    expect(matches.map((m) => ({ slug: m.term.s, amb: m.ambiguous }))).toEqual([
      { slug: 'agent', amb: true },
      { slug: 'model', amb: true },
      { slug: 'vibe-coding', amb: false },
      { slug: 'agent', amb: false },
    ])
  })

  it('compiles 3,500 terms and scans 25,000 characters smoothly', () => {
    const bulk: ExtensionGlossaryTerm[] = Array.from({ length: 3500 }, (_, i) => ({
      s: `term-${i}`,
      n: `Synthetic Term ${i}`,
      a: [`SynAlias${i}`],
      d: 'Definition text.',
    }))
    const t0 = performance.now()
    const bigMatcher = compileGlossaryMatcher(bulk)
    const haystack = 'Regular text '.repeat(1800) + 'using Synthetic Term 42 and SynAlias3499.'
    const hits = findMatchesInText(bigMatcher, haystack)
    const elapsed = performance.now() - t0

    expect(hits.map((h) => h.term.s)).toEqual(['term-42', 'term-3499'])
    expect(elapsed).toBeLessThan(500)
  })

  it('detects German vs English from html lang or text sample', () => {
    expect(detectPageLanguage('de-DE', 'Hello world')).toBe('de')
    expect(detectPageLanguage('en-US', 'Hallo Welt')).toBe('en')
    expect(
      detectPageLanguage('', 'Das ist ein Artikel für die Nutzer und nicht eine englische Seite.'),
    ).toBe('de')
    expect(
      detectPageLanguage('', 'This is an English article for developers with many examples.'),
    ).toBe('en')
  })
})

describe('Backend extension index helpers', () => {
  it('filters stop aliases and duplicates of canonicalName', () => {
    expect(cleanAliasList('Artificial Intelligence', ['AI', 'ai', 'Artificial Intelligence', 'Künstliche Intelligenz', 'x'])).toEqual([
      'Künstliche Intelligenz',
    ])
  })

  it('identifies homonyms while allowing full phrases', () => {
    expect(isAmbiguousTerm('Agent', [])).toBe(true)
    expect(isAmbiguousTerm('RAG', [])).toBe(true)
    expect(isAmbiguousTerm('LLM', [])).toBe(false)
    expect(isAmbiguousTerm('Retrieval-Augmented Generation', ['RAG'])).toBe(false)
  })

  it('extracts full structured plain-text blocks from TipTap JSON beyond 1,400 chars without emitting HTML', () => {
    const longParagraph = 'A'.repeat(1600)
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          content: [{ type: 'text', text: 'Wie es funktioniert' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Erster Absatz über {lex:Transformer} und <script>alert(1)</script>.' }],
        },
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ein wichtiges Zitat.' }] }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Listenpunkt eins.' }] }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: longParagraph }],
        },
      ],
    }

    expect(extractTipTapPlainBlocks(doc)).toEqual([
      { type: 'heading', text: 'Wie es funktioniert' },
      { type: 'paragraph', text: 'Erster Absatz über Transformer und alert(1).' },
      { type: 'quote', text: 'Ein wichtiges Zitat.' },
      { type: 'listItem', text: 'Listenpunkt eins.' },
      { type: 'paragraph', text: longParagraph },
    ])
    expect(extractTipTapPlainParagraphs(doc)).toHaveLength(5)
    expect(stripPlainText('See [Docs](https://example.com) and <b>RAG</b>.', 100)).toBe(
      'See Docs and RAG.',
    )
  })
})
