import { describe, expect, it } from 'vitest'
import { findGlossaryMentions, extractLexTags, stripLexTags } from '@/lib/glossary/mentions'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

const terms: GlossaryMatcherTerm[] = [
  { slug: 'mixture-of-experts', canonicalName: 'Mixture of Experts', aliases: ['MoE', 'Mixture-of-Experts'] },
  { slug: 'inferenz', canonicalName: 'Inferenz', aliases: ['Inferenzkosten'] },
  { slug: 'rag', canonicalName: 'RAG', aliases: [] },
]

describe('findGlossaryMentions', () => {
  it('findet den kanonischen Namen case-insensitive', () => {
    const hits = findGlossaryMentions('Das Modell nutzt mixture of experts.', terms)
    expect(hits.map(h => h.slug)).toEqual(['mixture-of-experts'])
  })

  it('findet Aliasse', () => {
    const hits = findGlossaryMentions('Ein MoE-Modell skaliert besser.', terms)
    expect(hits.map(h => h.slug)).toEqual(['mixture-of-experts'])
  })

  it('respektiert Wortgrenzen mit Umlauten und Komposita', () => {
    const hits = findGlossaryMentions('Die Inferenzkosten sinken.', terms)
    expect(hits.map(h => h.slug)).toEqual(['inferenz'])
  })

  it('matcht nicht innerhalb eines Wortes', () => {
    expect(findGlossaryMentions('Ragout kochen', terms)).toEqual([])
  })

  it('findet kurze Abkürzungen als eigenständiges Wort', () => {
    const hits = findGlossaryMentions('Wir nutzen RAG dafür.', terms)
    expect(hits.map(h => h.slug)).toEqual(['rag'])
  })

  it('meldet jeden Begriff nur einmal', () => {
    const hits = findGlossaryMentions('Inferenz hier, Inferenz dort.', terms)
    expect(hits).toHaveLength(1)
  })

  it('begrenzt auf max', () => {
    const hits = findGlossaryMentions('Inferenz und Mixture of Experts.', terms, 1)
    expect(hits).toHaveLength(1)
  })

  it('kurzer Alias trifft nicht als Wortpräfix (Aida)', () => {
    const aiTerm: GlossaryMatcherTerm = { slug: 'ai', canonicalName: 'Artificial Intelligence', aliases: ['AI'] }
    expect(findGlossaryMentions('Aida singt.', [aiTerm])).toEqual([])
  })

  it('kurzer Alias trifft mit Bindestrich-Grenze', () => {
    const moeTerm: GlossaryMatcherTerm = { slug: 'moe', canonicalName: 'Mixture of Experts', aliases: ['MoE'] }
    const hits = findGlossaryMentions('Ein MoE-Modell skaliert.', [moeTerm])
    expect(hits.map(h => h.slug)).toEqual(['moe'])
  })

  it('kurzer Alias trifft nicht mit angehängtem Buchstaben', () => {
    const moeTerm: GlossaryMatcherTerm = { slug: 'moe', canonicalName: 'Mixture of Experts', aliases: ['MoE'] }
    expect(findGlossaryMentions('MoEs skalieren gut.', [moeTerm])).toEqual([])
  })

  it('Kompositum über Substring ohne exakten Alias', () => {
    const inferenzTerm: GlossaryMatcherTerm = { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] }
    const hits = findGlossaryMentions('Die Inferenzkosten sinken.', [inferenzTerm])
    expect(hits.map(h => h.slug)).toEqual(['inferenz'])
  })

  it('Umlaut an Wortgrenze in Kompositum', () => {
    const embeddingTerm: GlossaryMatcherTerm = { slug: 'einbettung', canonicalName: 'Einbettung', aliases: ['Worteinbettung'] }
    const hits = findGlossaryMentions('Die Wörter-Einbettung ist zentral.', [embeddingTerm])
    expect(hits.map(h => h.slug)).toEqual(['einbettung'])
  })

  it('escapeRegex mit Regex-Sonderzeichen im Namen', () => {
    const gptTerm: GlossaryMatcherTerm = { slug: 'gpt-4-turbo', canonicalName: 'GPT-4 (Turbo)', aliases: [] }
    const hits = findGlossaryMentions('Wir nutzen GPT-4 (Turbo) dafür.', [gptTerm])
    expect(hits.map(h => h.slug)).toEqual(['gpt-4-turbo'])
  })

  it('escapeRegex verhindert Regex-Interpretation', () => {
    const gptTerm: GlossaryMatcherTerm = { slug: 'gpt-4-turbo', canonicalName: 'GPT-4 (Turbo)', aliases: [] }
    const hits = findGlossaryMentions('GPT4Turbo ist nicht gleich GPT-4 (Turbo).', [gptTerm])
    expect(hits.map(h => h.slug)).toEqual(['gpt-4-turbo'])
  })
})

describe('extractLexTags', () => {
  it('liest Begriffsnamen aus {lex:...}-Direktiven im TipTap-Baum', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Ein {lex:Mixture of Experts}-Modell und {lex:Inferenz}.' }],
      }],
    }
    expect(extractLexTags(doc)).toEqual(['Mixture of Experts', 'Inferenz'])
  })

  it('liefert bei fehlenden Tags ein leeres Array', () => {
    expect(extractLexTags({ type: 'doc', content: [] })).toEqual([])
  })

  it('dedupliziert echte Duplikate', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: '{lex:Inferenz} und nochmal {lex:Inferenz}.' }],
      }],
    }
    expect(extractLexTags(doc)).toEqual(['Inferenz'])
  })
})

describe('stripLexTags', () => {
  it('entfernt die Direktive und behält den Begriff', () => {
    expect(stripLexTags('Ein {lex:Mixture of Experts}-Modell.')).toBe('Ein Mixture of Experts-Modell.')
  })
})
