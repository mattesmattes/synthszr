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

  it('überspringt Namen unter der Mindestlänge', () => {
    expect(findGlossaryMentions('Wir nutzen RAG dafür.', terms).map(h => h.slug)).toEqual([])
  })

  it('meldet jeden Begriff nur einmal', () => {
    const hits = findGlossaryMentions('Inferenz hier, Inferenz dort.', terms)
    expect(hits).toHaveLength(1)
  })

  it('begrenzt auf max', () => {
    const hits = findGlossaryMentions('Inferenz und Mixture of Experts.', terms, 1)
    expect(hits).toHaveLength(1)
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
})

describe('stripLexTags', () => {
  it('entfernt die Direktive und behält den Begriff', () => {
    expect(stripLexTags('Ein {lex:Mixture of Experts}-Modell.')).toBe('Ein Mixture of Experts-Modell.')
  })
})
