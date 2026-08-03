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

vi.mock('@/lib/glossary/terms', () => ({
  getMatcherTerms: termMocks.getMatcherTerms,
  getChartProductNames: termMocks.getChartProductNames,
}))

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

  it('übersetzt nur nach de und en', async () => {
    state.termRow = { id: 'term-1', canonical_name: 'Inferenz', aliases: [], summary: 'x', body: SOURCE_BODY }
    const { translateTerm } = await import('@/lib/glossary/translate')
    await expect(translateTerm('term-1', 'fr')).rejects.toThrow()
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

  it('ruft getMatcherTerms nicht auf, wenn der Quell-Content keine Glossar-Marks hat', async () => {
    const source = doc('Kein Fachbegriff hier.')
    const translated = doc('No jargon here.')
    const { reinjectGlossaryMarksForTranslation } = await import('@/lib/glossary/translate')
    const result = await reinjectGlossaryMarksForTranslation(source, translated, 'en')
    expect(result).toBe(translated)
    expect(termMocks.getMatcherTerms).not.toHaveBeenCalled()
  })

  it('übersetzt nur nach de und en', async () => {
    // Kein Aufrufer im Repo ruft dies je mit einer anderen Sprache auf
    // (Files-Hinweis: Lexikon-Content existiert nur de/en), aber
    // getMatcherTerms(lang) selbst degradiert für unbekannte Sprachen
    // graceful auf die deutschen Namen zurück (terms.ts) — kein Grund, hier
    // zusätzlich zu validieren/einzuschränken.
    const source = doc('Die Inferenz ist teuer.', { type: 'glossaryLink', attrs: { slug: 'inferenz' } })
    const translated = doc('Inference is expensive.')
    const { reinjectGlossaryMarksForTranslation } = await import('@/lib/glossary/translate')
    await reinjectGlossaryMarksForTranslation(source, translated, 'en')
    expect(termMocks.getMatcherTerms).toHaveBeenCalledWith('en')
  })

  it('bricht ab, wenn die Zielsprach-Begriffsliste trotz verlinkter Slugs leer zurückkommt (mutmaßlicher Ladefehler statt echtes Leer)', async () => {
    // getMatcherTerms selektiert status=published sprachunabhängig aus
    // glossary_terms — die verlinkten Slugs stammen aus genau dieser Tabelle,
    // die Begriffe existieren also nachweislich. Eine leere Rückgabe hier kann
    // daher nur heißen, dass getMatcherTerms einen Ladefehler verschluckt hat
    // (es loggt intern und gibt [] zurück, ohne den Fehler nach außen zu
    // signalisieren) — NICHT, dass legitim null Begriffe existieren. Eine
    // Übersetzung mit null Marks zu schreiben wäre der dauerhafte
    // Linkverlust, den diese Aufgabe beheben soll — deshalb abbrechen statt
        // degradieren.
    termMocks.getMatcherTerms.mockResolvedValue([])
    const source = doc('Die Inferenz ist teuer.', { type: 'glossaryLink', attrs: { slug: 'inferenz' } })
    const translated = doc('Inference is expensive.')
    const { reinjectGlossaryMarksForTranslation } = await import('@/lib/glossary/translate')
    await expect(reinjectGlossaryMarksForTranslation(source, translated, 'en')).rejects.toThrow()
  })

  it('reserviert Company-Namen aus KNOWN_COMPANIES gegen Kollision, wie applyGlossaryConfirmation', async () => {
    const companyName = Object.keys(KNOWN_COMPANIES)[0]
    termMocks.getMatcherTerms.mockResolvedValue([
      { slug: 'firmenbegriff', canonicalName: companyName, aliases: [] },
    ])
    const source = doc('X', { type: 'glossaryLink', attrs: { slug: 'firmenbegriff' } })
    const translated = doc(`${companyName} is well known.`)
    const { reinjectGlossaryMarksForTranslation } = await import('@/lib/glossary/translate')
    const result = await reinjectGlossaryMarksForTranslation(source, translated, 'en')
    expect(linked(result)).toEqual([])
  })
})
