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

  // PROD-SCAN 2026-08-06: haeufigster Fehltreffer im ganzen Lexikon. Auf 148
  // Seiten war das Wort "Branche" als Git-Branch verlinkt. Perfider als der
  // Compute-Fall: "e" gilt als Flexionsendung, extendByInflection dehnte den
  // Treffer deshalb ueber das GANZE Wort aus — der Link sah voellig korrekt aus.
  const branchTerm: GlossaryMatcherTerm = { slug: 'branch', canonicalName: 'Branch', aliases: [] }

  it('trifft nicht das deutsche Wort Branche (Branch + Flexions-e)', () => {
    expect(findGlossaryMentions('Die ganze Branche diskutiert das.', [branchTerm])).toEqual([])
  })

  it('trifft nicht den Plural Branchen', () => {
    expect(findGlossaryMentions('Andere Branchen folgen bald.', [branchTerm])).toEqual([])
  })

  it('trifft weiterhin den Git-Branch als eigenständiges Wort', () => {
    const hits = findGlossaryMentions('Der Branch wurde gemerged.', [branchTerm])
    expect(hits.map((h) => h.slug)).toEqual(['branch'])
  })

  // PROD-BEFUND 2026-08-07: im ENGLISCHEN Artikeltext war "The diff|erence
  // sounds technical" verlinkt — "Diff" hat genau 4 Zeichen und faellt damit
  // knapp auf die Kompositum-Seite der Laengenregel (4 < 4 ist falsch).
  const diffTerm: GlossaryMatcherTerm = { slug: 'diff', canonicalName: 'Diff', aliases: [] }

  it('trifft nicht das Wortinnere von "difference"', () => {
    expect(findGlossaryMentions('The difference sounds technical.', [diffTerm])).toEqual([])
  })

  it('trifft nicht das deutsche "Differenz"', () => {
    expect(findGlossaryMentions('Die Differenz ist gering.', [diffTerm])).toEqual([])
  })

  it('trifft "Diff" weiterhin als eigenständiges Wort', () => {
    const hits = findGlossaryMentions('Der Diff zeigt zwei Zeilen.', [diffTerm])
    expect(hits.map((h) => h.slug)).toEqual(['diff'])
  })

  // Die Kompositum-Regel ist eine DEUTSCHE Regel: "Inferenzkosten" ist ein
  // zusammengesetztes Wort mit "Inferenz" als Erstglied. Im Englischen gibt es
  // diese Zusammenschreibung nicht — dort ist ein Treffer im Wortinneren immer
  // ein Fehlgriff, und die Liste einzelner Ausnahmen (WHOLE_WORD_ONLY) waere
  // ein Fass ohne Boden.
  describe('Kompositum-Regel nur für Deutsch', () => {
    const inferenz: GlossaryMatcherTerm = { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] }

    it('trifft im deutschen Text weiterhin im Kompositum', () => {
      const hits = findGlossaryMentions('Die Inferenzkosten sinken.', [inferenz], undefined, 'de')
      expect(hits.map((h) => h.slug)).toEqual(['inferenz'])
    })

    it('trifft im englischen Text NICHT im Wortinneren', () => {
      const token: GlossaryMatcherTerm = { slug: 'token', canonicalName: 'Token', aliases: [] }
      expect(findGlossaryMentions('The tokenizer splits words.', [token], undefined, 'en')).toEqual([])
    })

    it('trifft im englischen Text weiterhin das ganze Wort', () => {
      const token: GlossaryMatcherTerm = { slug: 'token', canonicalName: 'Token', aliases: [] }
      const hits = findGlossaryMentions('Each token costs money.', [token], undefined, 'en')
      expect(hits.map((h) => h.slug)).toEqual(['token'])
    })
  })

  // PROD-BEFUND 2026-08-10 (Betreiber): im Partizip "genommen" war der Begriff
  // "Genom" verlinkt — 5 Zeichen, also ueber der Ganzwort-Schwelle und damit auf
  // der Kompositum-Seite. Die Endung "men" stand ausserhalb des Links.
  //
  // Der Fix ist BEWUSST keine weitere Zeile in WHOLE_WORD_ONLY: diese Liste
  // waechst sonst mit jedem Fund (compute, branch, diff, genom, …) und faengt
  // immer nur den bereits entdeckten Fall. Stattdessen greift eine allgemeine
  // Regel des Deutschen — ein Substantiv-Kompositum wird IMMER grossgeschrieben.
  // Trifft ein grossgeschriebener Begriff am Anfang eines KLEINgeschriebenen
  // Wortes, das noch weitergeht, ist es kein Kompositum, sondern ein Verb oder
  // Adjektiv, das zufaellig so beginnt.
  describe('grossgeschriebene Begriffe treffen nicht in kleingeschriebenen Woertern', () => {
    const genom: GlossaryMatcherTerm = { slug: 'genom', canonicalName: 'Genom', aliases: [] }

    it('trifft nicht im Partizip "genommen"', () => {
      expect(findGlossaryMentions('Das wurde in Kauf genommen.', [genom])).toEqual([])
    })

    it('trifft nicht im Adjektiv "genomische"', () => {
      expect(findGlossaryMentions('Die genomische Analyse laeuft.', [genom])).toEqual([])
    })

    it('trifft weiterhin im echten Kompositum "Genomsequenzierung"', () => {
      const hits = findGlossaryMentions('Die Genomsequenzierung ist teuer.', [genom])
      expect(hits.map((h) => h.slug)).toEqual(['genom'])
    })

    it('trifft weiterhin als eigenstaendiges Wort', () => {
      const hits = findGlossaryMentions('Das Genom ist entschluesselt.', [genom])
      expect(hits.map((h) => h.matchedText)).toEqual(['Genom'])
    })

    it('findet die ECHTE Erwaehnung, wenn davor ein Fehltreffer steht', () => {
      // Ohne Weitersuchen bliebe es beim abgelehnten ersten Treffer, und der
      // Begriff waere im ganzen Artikel unverlinkt — ein stiller Verlust.
      const hits = findGlossaryMentions('In Kauf genommen. Das Genom ist entschluesselt.', [genom])
      expect(hits.map((h) => h.matchedText)).toEqual(['Genom'])
    })

    it('gilt fuer die ganze Klasse, nicht nur fuer Genom (Token/tokenisierte)', () => {
      const token: GlossaryMatcherTerm = { slug: 'token', canonicalName: 'Token', aliases: [] }
      expect(findGlossaryMentions('Die tokenisierte Eingabe.', [token])).toEqual([])
    })

    // REGRESSIONSSCHUTZ: englische Fachbegriffe stehen im deutschen Fliesstext
    // oft klein ("deep learning"). Als GANZES Wort muessen sie weiter treffen —
    // die Regel darf nur greifen, wenn das Wort nach dem Treffer weitergeht.
    it('trifft kleingeschriebene Begriffe weiterhin als ganzes Wort', () => {
      const dl: GlossaryMatcherTerm = { slug: 'deep-learning', canonicalName: 'Deep Learning', aliases: [] }
      const hits = findGlossaryMentions('Moderne Systeme nutzen deep learning intensiv.', [dl])
      expect(hits.map((h) => h.slug)).toEqual(['deep-learning'])
    })
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
