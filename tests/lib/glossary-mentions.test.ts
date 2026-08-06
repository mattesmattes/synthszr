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

  // PROD-BEFUND 2026-08-06 auf /de/glossary/eu-ai-act: im Satz "Es wurde 2024
  // verabschiedet" war das Pronomen "Es" als Engineering Sample verlinkt. Die
  // Abkürzung ES ist zwei Zeichen lang, hatte also beidseitige Wortgrenzen —
  // die halfen nicht, weil der Vergleich case-insensitiv lief.
  const esTerm: GlossaryMatcherTerm = {
    slug: 'engineering-sample',
    canonicalName: 'Engineering Sample',
    aliases: ['ES', 'ES-Chip'],
  }

  it('Abkürzung trifft nicht das gleichlautende deutsche Wort (Es/ES)', () => {
    expect(findGlossaryMentions('Es wurde 2024 verabschiedet.', [esTerm])).toEqual([])
  })

  it('Abkürzung trifft weiterhin in korrekter Schreibung (ES)', () => {
    const hits = findGlossaryMentions('Das ES kam vor dem Serienchip.', [esTerm])
    expect(hits.map((h) => h.slug)).toEqual(['engineering-sample'])
  })

  // PROD-BEFUND 2026-08-06, gleiche Seite: in "Computerprogrammen" war "Compute"
  // verlinkt, das "rprogrammen" stand ausserhalb des Links. Die Kompositum-Regel
  // erlaubt Praefix-Treffer ("Inferenzkosten" -> "Inferenz"), aber "Computer" ist
  // kein Kompositum mit "Compute" als Erstglied, sondern ein eigenes Wort.
  const computeTerm: GlossaryMatcherTerm = { slug: 'compute', canonicalName: 'Compute', aliases: [] }

  it('trifft nicht als Präfix eines anderen Wortes (Compute/Computerprogramm)', () => {
    expect(findGlossaryMentions('Programme mit Computerprogrammen.', [computeTerm])).toEqual([])
  })

  it('trifft weiterhin als eigenständiges Wort (Compute)', () => {
    const hits = findGlossaryMentions('Dafür braucht es mehr Compute.', [computeTerm])
    expect(hits.map((h) => h.slug)).toEqual(['compute'])
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

  it('trifft einen Namen nach einem Bindestrich', () => {
    const embeddingTerm: GlossaryMatcherTerm = { slug: 'einbettung', canonicalName: 'Einbettung', aliases: ['Worteinbettung'] }
    const hits = findGlossaryMentions('Die Wörter-Einbettung ist zentral.', [embeddingTerm])
    expect(hits.map(h => h.slug)).toEqual(['einbettung'])
  })

  it('behandelt einen Umlaut vor dem Namen als Wortzeichen', () => {
    // 'fen' ist 3 Zeichen, wird also beidseitig begrenzt geprüft.
    // \p{L} erkennt 'Ö' als Buchstaben -> keine Wortgrenze -> kein Treffer.
    // Eine naive \b-Regex würde 'Ö' als Nicht-Wortzeichen sehen und
    // fälschlich treffen. Genau diese Unterscheidung ist der Grund für die
    // Unicode-Klassen, und nur dieser Test beweist sie.
    const fen = [{ slug: 'fen', canonicalName: 'fen', aliases: [] }]
    expect(findGlossaryMentions('Öfen sind heiss.', fen)).toEqual([])
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
