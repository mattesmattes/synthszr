/**
 * Übersetzung fürs Fachbegriff-Lexikon (Task 16).
 *
 * translateTerm: übersetzt canonical_name/aliases/summary/body eines Begriffs
 * und schreibt nach glossary_term_translations. Eigener Use Case
 * (glossary_translation), Anthropic-Tool-Call-Muster wie generate.ts/
 * products.ts — NICHT translateContent/translateWithClaude
 * (lib/i18n/translation-service.ts): jener Service ist auf Artikel
 * zugeschnitten (title/excerpt/content, Chunking, Slug-Generierung,
 * bundleType-Wiederherstellung) und kennt kein Aliase-Array. Läuft NICHT über
 * translation_queue (CHECK-Constraint kennt nur generated_post|static_page|ui,
 * und der Cron verarbeitet nur 3 Übersetzungen/15min — Glossareinträge würden
 * die täglichen Artikelübersetzungen verdrängen).
 *
 * reinjectGlossaryMarksForTranslation: injiziert Glossar-Marks in übersetzten
 * ARTIKEL-Content neu, mit der Begriffsliste der Zielsprache. Die Marks selbst
 * werden NICHT durch die Übersetzung getragen (ordinales Matching bricht,
 * wenn Textknoten verschmelzen/sich aufspalten — das Problem, an dem
 * reapplyBundleTypeAttrs sich abarbeitet) — nur die verlinkten SLUGS
 * (identitätsbasiert, aus den bestehenden glossaryLink-Marks der Quelle)
 * werden übernommen, die Textstelle wird im übersetzten Text neu gesucht.
 *
 * Fix-Runde 1 (Review): SUPPORTED_GLOSSARY_LANGS ist jetzt nur noch ['en']
 * (vorher de+en — de ist die Quellsprache und wird nie gerendert, Minor 2+3).
 * reinjectGlossaryMarksForTranslation bricht bei einer leeren
 * Zielsprach-Begriffsliste nicht mehr ab, sondern loggt sichtbar und
 * speichert die Übersetzung trotzdem (Important 1) — ein harter Abbruch traf
 * auch den legitimen Fall "Begriff zwischenzeitlich hidden".
 *
 * Fix-Runde 2 (Review): die Fix-Runde-1-Lösung für Important 1 prüfte nur
 * eine Vorbedingung (Begriffsliste leer?) — das übersieht den häufigsten
 * Verlustpfad (Begriff existiert, aber noch mit deutschem Namen, siehe der
 * "Pfad 2"-Pflichttest unten). Jetzt wird das ERGEBNIS der Injektion
 * gemessen (tatsächlich gesetzte Marks vs. ursprünglich verlinkte Slugs).
 * Außerdem: `getMatcherTerms`-Rückgabe `null` (transienter Ladefehler) wirft
 * jetzt, statt nur zu loggen — das gehört in den Queue-Retry, nicht in
 * log-and-continue, sonst kostet ein kurzer DB-Aussetzer die Links
 * permanent. Der Blockzahl-Check in translateTerm vergleicht jetzt gegen
 * translatedBody.content.length (nicht die rohe Blockzahl) und
 * stop_reason=max_tokens wird direkt geprüft.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { KNOWN_COMPANIES } from '@/lib/data/companies'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.create }
  },
}))

vi.mock('@/lib/ai/model-config', () => ({
  getModelForUseCase: vi.fn(async () => 'claude-opus-5'),
}))

const termMocks = vi.hoisted(() => ({
  getMatcherTerms: vi.fn(),
  getChartProductNames: vi.fn(() => Promise.resolve([] as string[])),
}))

// buildReservedNames bleibt die ECHTE Implementierung (importOriginal) — sie
// ist pur und wird mit applyGlossaryConfirmation (confirm.ts) geteilt, statt
// hier dupliziert zu sein (Review-Fund Important 2, Fix-Runde 1).
vi.mock('@/lib/glossary/terms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/glossary/terms')>()
  return {
    ...actual,
    getMatcherTerms: termMocks.getMatcherTerms,
    getChartProductNames: termMocks.getChartProductNames,
  }
})

const state = vi.hoisted(() => ({
  termRow: null as unknown,
  termError: null as { message: string } | null,
  upsertError: null as { message: string } | null,
  upserts: [] as Array<{ rows: unknown; onConflict?: string }>,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = { table }
      chain.select = vi.fn(() => chain)
      chain.eq = vi.fn(() => chain)
      chain.maybeSingle = vi.fn(async () => {
        if (table === 'glossary_terms') return { data: state.termRow, error: state.termError }
        return { data: null, error: null }
      })
      chain.upsert = vi.fn((rows: unknown, options?: { onConflict: string }) => {
        state.upserts.push({ rows, onConflict: options?.onConflict })
        return Promise.resolve({ error: state.upsertError })
      })
      return chain
    },
  }),
}))

function toolUse(input: unknown) {
  return { content: [{ type: 'tool_use', input }] }
}

/** Sammelt alle Textknoten mit glossaryLink-Mark, flach — Muster aus
 *  tests/lib/glossary-inject-marks.test.ts / tests/lib/glossary-confirm.test.ts. */
function linked(json: unknown): Array<{ text: string; slug: string }> {
  const out: Array<{ text: string; slug: string }> = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    const marks = Array.isArray(o.marks) ? o.marks : []
    const mark = marks.find((m) => (m as { type?: string }).type === 'glossaryLink')
    if (typeof o.text === 'string' && mark) {
      out.push({ text: o.text, slug: (mark as { attrs: { slug: string } }).attrs.slug })
    }
    if (Array.isArray(o.content)) o.content.forEach(walk)
  }
  walk(json)
  return out
}

function doc(text: string, mark?: { type: string; attrs: Record<string, unknown> }) {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text, ...(mark ? { marks: [mark] } : {}) }],
    }],
  }
}

const SOURCE_BODY = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Die Inferenz ist teuer.' }] },
    { type: 'heading', content: [{ type: 'text', text: 'Warum das wichtig ist' }] },
  ],
}

beforeEach(() => {
  mocks.create.mockReset()
  termMocks.getMatcherTerms.mockReset()
  termMocks.getChartProductNames.mockReset()
  termMocks.getChartProductNames.mockResolvedValue([])
  state.termRow = null
  state.termError = null
  state.upsertError = null
  state.upserts = []
})

describe('translateTerm', () => {
  it('übersetzt canonical_name/aliases/summary/body und schreibt nach glossary_term_translations', async () => {
    state.termRow = {
      id: 'term-1', canonical_name: 'Inferenz', aliases: ['Inference-Phase'],
      summary: 'Kurzfassung.', body: SOURCE_BODY,
    }
    mocks.create.mockResolvedValueOnce(toolUse({
      canonical_name: 'Inference',
      aliases: ['Inference phase'],
      summary: 'Short version.',
      blocks: [
        { type: 'paragraph', text: 'Inference is expensive.' },
        { type: 'heading', text: 'Why it matters' },
      ],
    }))
    const { translateTerm } = await import('@/lib/glossary/translate')
    await translateTerm('term-1', 'en')

    expect(state.upserts).toHaveLength(1)
    const written = state.upserts[0].rows as Record<string, unknown>
    expect(written.term_id).toBe('term-1')
    expect(written.language).toBe('en')
    expect(written.canonical_name).toBe('Inference')
    expect(written.aliases).toEqual(['Inference phase'])
    expect(written.summary).toBe('Short version.')
    expect((written.body as { content: unknown[] }).content).toHaveLength(2)
    expect(state.upserts[0].onConflict).toBe('term_id,language')
  })

  it('übersetzt nur nach en — de (die Quellsprache, nie gerendert) und andere Sprachen werden abgelehnt', async () => {
    // Fix-Runde 1, Minor 2+3: 'de' war ursprünglich erlaubt, wird aber nie
    // gelesen (applyTermTranslation ruft die Übersetzungstabelle nur für
    // lang !== 'de' auf) — reiner API-Kosten-Verschleiß, deshalb jetzt
    // ebenfalls abgelehnt, nicht nur eindeutig falsche Codes wie 'fr'.
    state.termRow = { id: 'term-1', canonical_name: 'Inferenz', aliases: [], summary: 'x', body: SOURCE_BODY }
    const { translateTerm } = await import('@/lib/glossary/translate')
    await expect(translateTerm('term-1', 'fr')).rejects.toThrow()
    await expect(translateTerm('term-1', 'de')).rejects.toThrow()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(state.upserts).toHaveLength(0)
  })

  it('wirft, wenn der Begriff nicht existiert', async () => {
    state.termRow = null
    const { translateTerm } = await import('@/lib/glossary/translate')
    await expect(translateTerm('missing', 'en')).rejects.toThrow()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('wirft bei ungültigem body, statt eine leere Übersetzung zu schreiben', async () => {
    state.termRow = { id: 'term-1', canonical_name: 'Inferenz', aliases: [], summary: 'x', body: { type: 'doc' } }
    const { translateTerm } = await import('@/lib/glossary/translate')
    await expect(translateTerm('term-1', 'en')).rejects.toThrow()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('wirft bei ungültiger Tool-Antwort, statt eine leere Übersetzung zu schreiben', async () => {
    state.termRow = { id: 'term-1', canonical_name: 'Inferenz', aliases: [], summary: 'x', body: SOURCE_BODY }
    mocks.create.mockResolvedValueOnce({ content: [] })
    const { translateTerm } = await import('@/lib/glossary/translate')
    await expect(translateTerm('term-1', 'en')).rejects.toThrow()
    expect(state.upserts).toHaveLength(0)
  })

  it('wirft, wenn die Blockzahl der Übersetzung von der Quelle abweicht (abgeschnittene Modellantwort, Minor 1)', async () => {
    // SOURCE_BODY hat 2 Blocks (paragraph + heading). Die Modellantwort
    // liefert nur 1 — ohne diese Prüfung würde buildTipTapBody das klaglos
    // zu einem verkürzten Übersetzungstext verarbeiten, den kein QA findet
    // (der Review-Cron liest nur die deutsche Quelle).
    state.termRow = { id: 'term-1', canonical_name: 'Inferenz', aliases: [], summary: 'x', body: SOURCE_BODY }
    mocks.create.mockResolvedValueOnce(toolUse({
      canonical_name: 'Inference', aliases: [], summary: 'x',
      blocks: [{ type: 'paragraph', text: 'Inference is expensive.' }], // nur 1 statt 2 Blocks
    }))
    const { translateTerm } = await import('@/lib/glossary/translate')
    await expect(translateTerm('term-1', 'en')).rejects.toThrow(/Blockzahl/)
    expect(state.upserts).toHaveLength(0)
  })

  it('wirft, wenn die rohe Blockzahl stimmt, aber ein Block leeren/Whitespace-Text hat (Minor 3, Fix-Runde 2)', async () => {
    // SOURCE_BODY hat 2 Blocks. Die Modellantwort liefert ebenfalls 2 (die
    // alte Prüfung t.blocks.length !== sourceBlocks.length hätte das
    // passieren lassen) — aber der zweite Block ist nur Whitespace.
    // buildTipTapBody verwirft solche Blocks kommentarlos (b.text.trim()),
    // die tatsächlich überlebende Blockzahl ist also nur 1. Der Vergleich
    // gegen translatedBody.content.length statt gegen die rohe t.blocks.length
    // deckt das auf.
    state.termRow = { id: 'term-1', canonical_name: 'Inferenz', aliases: [], summary: 'x', body: SOURCE_BODY }
    mocks.create.mockResolvedValueOnce(toolUse({
      canonical_name: 'Inference', aliases: [], summary: 'x',
      blocks: [
        { type: 'paragraph', text: 'Inference is expensive.' },
        { type: 'heading', text: '   ' }, // rohe Blockzahl stimmt (2), Text ist leer
      ],
    }))
    const { translateTerm } = await import('@/lib/glossary/translate')
    await expect(translateTerm('term-1', 'en')).rejects.toThrow(/Blockzahl/)
    expect(state.upserts).toHaveLength(0)
  })

  it('wirft, wenn die Modellantwort mit stop_reason=max_tokens abgeschnitten wurde (Minor 4, Fix-Runde 2)', async () => {
    // Direkter Beleg statt nur Proxy (Blockzahl-Check) — vor dem Tool-Parsing
    // geprüft, eine abgeschnittene Antwort kann ohnehin kein valides
    // tool_use-JSON liefern.
    state.termRow = { id: 'term-1', canonical_name: 'Inferenz', aliases: [], summary: 'x', body: SOURCE_BODY }
    mocks.create.mockResolvedValueOnce({
      stop_reason: 'max_tokens',
      content: [{ type: 'tool_use', input: { canonical_name: 'Inference', aliases: [], summary: 'x', blocks: [] } }],
    })
    const { translateTerm } = await import('@/lib/glossary/translate')
    await expect(translateTerm('term-1', 'en')).rejects.toThrow(/max_tokens/)
    expect(state.upserts).toHaveLength(0)
  })

  it('wirft, wenn der Upsert fehlschlägt', async () => {
    state.termRow = { id: 'term-1', canonical_name: 'Inferenz', aliases: [], summary: 'x', body: SOURCE_BODY }
    state.upsertError = { message: 'constraint violation' }
    mocks.create.mockResolvedValueOnce(toolUse({
      canonical_name: 'Inference', aliases: [], summary: 'x',
      blocks: [{ type: 'paragraph', text: 'x' }],
    }))
    const { translateTerm } = await import('@/lib/glossary/translate')
    await expect(translateTerm('term-1', 'en')).rejects.toThrow()
  })

  it('wirft, wenn Quelle UND Übersetzung 0 Blocks haben, statt einen leeren body zu schreiben (Task 18, Review-Fund)', async () => {
    // Der `=== 0`-Zweig ging in einer früheren Fix-Runde verloren: mit
    // sourceBlocks.length === 0 wird `translatedBody.content.length !==
    // sourceBlocks.length` zu `0 !== 0` (false) — kein Throw, ein leerer body
    // würde geschrieben. Praktisch unerreichbar über die beiden regulären
    // Schreibpfade (generate.ts' ContentSchema verlangt min(4) Blocks,
    // review.ts lehnt einen leeren pendingBody ab) — Verteidigung gegen einen
    // Bestandsdatensatz mit body.content = [], den keiner der beiden Pfade
    // verhindert hat. Fix-Runde 1 (Minor 4): eigene Fehlermeldung statt der
    // Blockzahl-Meldung — „0 weicht von 0 ab" läse sich wie ein
    // Vergleichsfehler, obwohl die Ursache der leere Quell-body ist.
    state.termRow = { id: 'term-1', canonical_name: 'X', aliases: [], summary: 'x', body: { type: 'doc', content: [] } }
    mocks.create.mockResolvedValueOnce(toolUse({ canonical_name: 'X', aliases: [], summary: 'x', blocks: [] }))
    const { translateTerm } = await import('@/lib/glossary/translate')
    await expect(translateTerm('term-1', 'en')).rejects.toThrow(/0 Blocks/)
    expect(state.upserts).toHaveLength(0)
  })
})

describe('reinjectGlossaryMarksForTranslation', () => {
  beforeEach(() => {
    termMocks.getMatcherTerms.mockResolvedValue([
      { slug: 'inferenz', canonicalName: 'Inference', aliases: [] },
    ])
  })

  it('verlinkt im übersetzten Content mit der übersetzten Begriffsliste (Marks werden neu gesetzt, nicht kopiert)', async () => {
    const source = doc('Die Inferenz ist teuer.', { type: 'glossaryLink', attrs: { slug: 'inferenz' } })
    const translated = doc('Inference is expensive.') // trägt KEINE Mark — muss neu injiziert werden
    const { reinjectGlossaryMarksForTranslation } = await import('@/lib/glossary/translate')
    const result = await reinjectGlossaryMarksForTranslation(source, translated, 'en')
    expect(linked(result)).toEqual([{ text: 'Inference', slug: 'inferenz' }])
  })

  it('nutzt vorgeladene Listen, statt sie je Aufruf erneut zu laden', async () => {
    // Fuer den Uebersetzungs-Backfill: der Lauf geht ueber hunderte Zeilen, und
    // getMatcherTerms/getChartProductNames sind pro Sprache konstant. Ohne
    // diesen Weg waeren es zwei DB-Abfragen JE ZEILE — bei 743 Zeilen rund
    // 1500 Roundtrips fuer Daten, die sich waehrend des Laufs nicht aendern.
    const source = doc('Die Inferenz ist teuer.', { type: 'glossaryLink', attrs: { slug: 'inferenz' } })
    const translated = doc('Inference is expensive.')
    const { reinjectGlossaryMarksForTranslation } = await import('@/lib/glossary/translate')

    const result = await reinjectGlossaryMarksForTranslation(source, translated, 'en', {
      terms: [{ slug: 'inferenz', canonicalName: 'Inference', aliases: [] }],
      reserved: [],
    })

    expect(linked(result)).toEqual([{ text: 'Inference', slug: 'inferenz' }])
    expect(termMocks.getMatcherTerms).not.toHaveBeenCalled()
    expect(termMocks.getChartProductNames).not.toHaveBeenCalled()
  })

  it('ruft getMatcherTerms nicht auf, wenn der Quell-Content keine Glossar-Marks hat', async () => {
    const source = doc('Kein Fachbegriff hier.')
    const translated = doc('No jargon here.')
    const { reinjectGlossaryMarksForTranslation } = await import('@/lib/glossary/translate')
    const result = await reinjectGlossaryMarksForTranslation(source, translated, 'en')
    expect(result).toBe(translated)
    expect(termMocks.getMatcherTerms).not.toHaveBeenCalled()
  })

  it('validiert die Zielsprache selbst nicht — reine Weitergabe an getMatcherTerms', async () => {
    // Anders als translateTerm (das targetLang gegen SUPPORTED_GLOSSARY_LANGS
    // prüft) validiert diese Funktion die Sprache nicht selbst: sie wird nur
    // von den Artikel-Übersetzungspfaden mit der jeweiligen Ziel-LanguageCode
    // aufgerufen, die schon vorher validiert wurde.
    const source = doc('Die Inferenz ist teuer.', { type: 'glossaryLink', attrs: { slug: 'inferenz' } })
    const translated = doc('Inference is expensive.')
    const { reinjectGlossaryMarksForTranslation } = await import('@/lib/glossary/translate')
    await reinjectGlossaryMarksForTranslation(source, translated, 'en')
    expect(termMocks.getMatcherTerms).toHaveBeenCalledWith('en')
  })

  it('loggt sichtbar, bricht aber nicht ab, wenn die Zielsprach-Begriffsliste komplett leer zurückkommt (permanenter Zustand)', async () => {
    // Kein Retry würde eine leere/nicht-passende Begriffsliste heilen (anders
    // als ein null-Ladefehler, siehe die beiden Tests unten) — Sichtbarkeit
    // (console.error) ist das Minimum, die Übersetzung wird trotzdem
    // gespeichert, nur eben ohne Glossar-Links.
    termMocks.getMatcherTerms.mockResolvedValue([])
    const source = doc('Die Inferenz ist teuer.', { type: 'glossaryLink', attrs: { slug: 'inferenz' } })
    const translated = doc('Inference is expensive.')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { reinjectGlossaryMarksForTranslation } = await import('@/lib/glossary/translate')
    const result = await reinjectGlossaryMarksForTranslation(source, translated, 'en')
    expect(errSpy).toHaveBeenCalled()
    expect(errSpy.mock.calls[0].join(' ')).toContain('inferenz')
    expect(linked(result)).toEqual([])
    errSpy.mockRestore()
  })

  it('loggt sichtbar (Ergebnis-Check), wenn ein verlinkter Begriff nur mit deutschem Namen zurückkommt — Pfad 2, Fix-Runde 2 (Pflichttest)', async () => {
    // DER Verlustpfad, den eine reine Vorbedingungsprüfung nicht sehen kann:
    // Slugs sind sprachunabhängig, getMatcherTerms('en') liefert für einen
    // Begriff OHNE eigene Übersetzungszeile den DEUTSCHEN Namen zurück
    // (terms.ts, legitimer Normalfall — heute der HÄUFIGSTE Fall, solange kaum
    // ein Begriff übersetzt ist). Der Slug taucht in der Liste auf (eine
    // Vorbedingungsprüfung auf "Liste leer?" sähe hier "alles ok"), aber der
    // deutsche Name "Inferenz" kommt im englischen Text nicht vor — erst der
    // Ergebnis-Check (tatsächlich gesetzte Marks zählen) deckt das auf.
    // Gegen den Stand VOR Fix-Runde 2 (Vorbedingungsprüfung auf `wanted`) ist
    // dieser Test rot: `wanted` wäre hier NICHT leer (der Slug matcht),
    // der alte Guard hätte also gar nicht gefeuert.
    termMocks.getMatcherTerms.mockResolvedValue([
      { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] }, // deutscher Name, keine en-Übersetzung
    ])
    const source = doc('Die Inferenz ist teuer.', { type: 'glossaryLink', attrs: { slug: 'inferenz' } })
    const translated = doc('Inference is expensive.') // "Inferenz" kommt hier nicht vor
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { reinjectGlossaryMarksForTranslation } = await import('@/lib/glossary/translate')
    const result = await reinjectGlossaryMarksForTranslation(source, translated, 'en')
    expect(errSpy).toHaveBeenCalled()
    expect(errSpy.mock.calls[0].join(' ')).toContain('inferenz')
    expect(linked(result)).toEqual([])
    errSpy.mockRestore()
  })

  it('bricht ab (throw), wenn getMatcherTerms null liefert — transienter Fehler, der Queue-Retry heilt ihn (Fix 2, Fix-Runde 2)', async () => {
    // Unterscheidung ist NICHT "loggen vs. abbrechen" nach Häufigkeit,
    // sondern "kann ein Retry es heilen?": null bedeutet, dass GENAU die
    // Übersetzungsabfrage in getMatcherTerms scheiterte (transienter
    // DB-Fehler) — dafür existiert der Queue-Retry (status bleibt 'pending'
    // bis MAX_ATTEMPTS). Log-and-continue würde hier eine dauerhaft linkfreie
    // Übersetzung festschreiben, obwohl ein zweiter Versuch Sekunden später
    // den Zustand vollständig heilen könnte.
    termMocks.getMatcherTerms.mockResolvedValue(null)
    const source = doc('Die Inferenz ist teuer.', { type: 'glossaryLink', attrs: { slug: 'inferenz' } })
    const translated = doc('Inference is expensive.')
    const { reinjectGlossaryMarksForTranslation } = await import('@/lib/glossary/translate')
    await expect(reinjectGlossaryMarksForTranslation(source, translated, 'en')).rejects.toThrow(/nicht ladbar/)
  })

  it('loggt sichtbar bei TEILVERLUST — 2 verlinkte Slugs, nur einer im übersetzten Text auffindbar (Task 18, Pflichttest für Fix-Runde 2)', async () => {
    // Genau die Eigenschaft, die den Ergebnis-Check dem Vorbedingungs-Check
    // überlegen macht: BEIDE Slugs sind gültige Kandidaten (eine
    // Vorbedingungsprüfung "ist die Liste leer?" sähe hier "alles ok"), aber
    // nur einer kommt im übersetzten Text tatsächlich vor. Die bisherigen
    // Tests decken nur "alles verloren" (0 von 1) ab, nicht diesen
    // Mischfall.
    termMocks.getMatcherTerms.mockResolvedValue([
      { slug: 'inferenz', canonicalName: 'Inference', aliases: [] },
      { slug: 'rechenzentrum', canonicalName: 'Rechenzentrum', aliases: [] }, // keine en-Übersetzung, deutscher Name bleibt
    ])
    const source = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Die Inferenz.', marks: [{ type: 'glossaryLink', attrs: { slug: 'inferenz' } }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Das Rechenzentrum.', marks: [{ type: 'glossaryLink', attrs: { slug: 'rechenzentrum' } }] }] },
      ],
    }
    const translated = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'The Inference.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'The data center.' }] }, // "Rechenzentrum" kommt hier nicht vor
      ],
    }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { reinjectGlossaryMarksForTranslation } = await import('@/lib/glossary/translate')
    const result = await reinjectGlossaryMarksForTranslation(source, translated, 'en')
    expect(errSpy).toHaveBeenCalled()
    expect(errSpy.mock.calls[0].join(' ')).toContain('1 von 2')
    expect(linked(result)).toEqual([{ text: 'Inference', slug: 'inferenz' }])
    errSpy.mockRestore()
  })

  it('reserviert Company-Namen aus KNOWN_COMPANIES gegen Kollision, wie applyGlossaryConfirmation', async () => {
    // Akzeptierter Nebeneffekt (siehe Kommentar in translate.ts): der
    // Ergebnis-Check loggt auch hier, weil weniger Marks gesetzt wurden als
    // im Original verlinkt waren — der Log-Eintrag ist dann harmlos (ein
    // Operator sieht in den Slugs, dass es sich um eine Kollision handelt),
    // aber nicht falsch. Deshalb console.error hier bewusst weggefangen,
    // statt den Test daran scheitern zu lassen.
    const companyName = Object.keys(KNOWN_COMPANIES)[0]
    termMocks.getMatcherTerms.mockResolvedValue([
      { slug: 'firmenbegriff', canonicalName: companyName, aliases: [] },
    ])
    const source = doc('X', { type: 'glossaryLink', attrs: { slug: 'firmenbegriff' } })
    const translated = doc(`${companyName} is well known.`)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { reinjectGlossaryMarksForTranslation } = await import('@/lib/glossary/translate')
    const result = await reinjectGlossaryMarksForTranslation(source, translated, 'en')
    expect(linked(result)).toEqual([])
    errSpy.mockRestore()
  })
})

/**
 * translatePublishedTerms — der automatische Auslöser nach dem Veröffentlichen.
 *
 * Vorher gab es nur den manuellen „Übersetzen"-Knopf: ein veröffentlichter
 * Begriff blieb auf /en/glossary/* dauerhaft deutsch, bis jemand ihn einzeln
 * anklickte. Jetzt rufen alle drei Publish-Pfade (Admin-Aktion,
 * Editor-Freigabe, Artikel-Crawl) diese Funktion.
 *
 * Die tragende Eigenschaft ist, dass sie NIE WIRFT: eine fehlende Übersetzung
 * ist ein Qualitätsmangel, ein fehlgeschlagenes Publish ein Datenfehler — der
 * teurere Fehler darf nicht vom billigeren ausgelöst werden. Die Seite fällt
 * ohne Übersetzung pro Feld auf die deutsche Fassung zurück, ist also nie leer.
 */
describe('translatePublishedTerms', () => {
  it('meldet Fehler als Zahl, statt sie zu werfen', async () => {
    // Kein Anthropic-Mock-Ergebnis gesetzt → translateTerm scheitert für beide.
    mocks.create.mockRejectedValue(new Error('LLM nicht erreichbar'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { translatePublishedTerms } = await import('@/lib/glossary/translate')
    const result = await translatePublishedTerms(['t1', 't2'])
    // Kein Wurf, sondern eine Bilanz — genau das brauchen die Publish-Pfade.
    expect(result.translated).toBe(0)
    expect(result.failed).toBe(2)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('gibt bei leerer Liste eine leere Bilanz zurück, ohne einen Call zu machen', async () => {
    mocks.create.mockClear()
    const { translatePublishedTerms } = await import('@/lib/glossary/translate')
    const result = await translatePublishedTerms([])
    expect(result).toEqual({ translated: 0, failed: 0 })
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
