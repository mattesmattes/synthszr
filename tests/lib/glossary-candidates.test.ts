/**
 * Kandidatenliste der Lexikon-Job-Phase (Task 10): führt die drei Quellen
 * ({lex:}-Tags, Matcher-Treffer gegen veröffentlichte Begriffe, LLM-Vorschläge
 * für neue Begriffe) zu einer Liste zusammen, die der Editor später zur
 * Freigabe zeigt. Für neue Begriffe generiert diese Funktion Inhalt (+ ggf.
 * Illustration) und legt sie als `status='draft'` an.
 *
 * Mock-Strategie: generateTermContent/generateGlossaryIllustration/
 * uploadGlossaryIllustration sind gemockt (bereits in glossary-generate.test.ts
 * bzw. glossary-illustration.test.ts gegen echtes Verhalten getestet) — hier
 * geht es um die Verdrahtung: welche Quelle gewinnt bei Kollision, wird der
 * Kosten-Bremse-Check vor der Generierung ausgeführt, überlebt die Liste einen
 * einzelnen fehlgeschlagenen Kandidaten. Der Supabase-Chain-Stub folgt dem
 * Muster aus tests/lib/rankings-resolve-product-db.test.ts / glossary-terms.test.ts.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { GeneratedTerm } from '@/lib/glossary/generate'

const mocks = vi.hoisted(() => ({
  generateTermContent: vi.fn(),
  generateGlossaryIllustration: vi.fn(),
  uploadGlossaryIllustration: vi.fn(),
}))

vi.mock('@/lib/glossary/generate', () => ({
  generateTermContent: mocks.generateTermContent,
}))

vi.mock('@/lib/gemini/image-generator', () => ({
  generateGlossaryIllustration: mocks.generateGlossaryIllustration,
  uploadGlossaryIllustration: mocks.uploadGlossaryIllustration,
}))

const state = vi.hoisted(() => ({
  draftRows: [] as unknown[],
  draftRowsError: null as { message: string } | null,
  inserts: [] as Array<Record<string, unknown>>,
  // Zeichnet jeden .in(...)-Aufruf auf jeder Chain auf — Review-Fix 1 prüft
  // damit, dass der Namens-Abgleich WIRKLICH gegen draft+hidden abfragt statt
  // nur zu behaupten, es zu tun (der Chain-Stub selbst ignoriert Filterwerte
  // bei der Datenauflösung, s.u.).
  inCalls: [] as unknown[][],
}))

function makeChain(table: string) {
  const chain: any = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.in = vi.fn((...args: unknown[]) => { state.inCalls.push(args); return chain })
  chain.order = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.insert = vi.fn((payload: Record<string, unknown>) => {
    state.inserts.push({ table, ...payload })
    return { error: null }
  })
  chain.then = (res: (v: unknown) => void) => res({
    data: table === 'glossary_terms' ? state.draftRows : [],
    error: table === 'glossary_terms' ? state.draftRowsError : null,
  })
  return chain
}

function makeSupabase() {
  return { from: vi.fn((table: string) => makeChain(table)) }
}

function fixtureGenerated(overrides: Partial<GeneratedTerm> = {}): GeneratedTerm {
  return {
    slug: 'mixture-of-experts',
    canonicalName: 'Mixture of Experts',
    aliases: ['MoE'],
    summary: 'Ein Ansatz, bei dem nur ein Teil des Modells pro Anfrage rechnet.',
    body: { type: 'doc', content: [] },
    needsIllustration: false,
    illustrationAlt: null,
    readabilityScore: 82,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.generateTermContent.mockReset()
  mocks.generateGlossaryIllustration.mockReset()
  mocks.uploadGlossaryIllustration.mockReset()
  state.draftRows = []
  state.draftRowsError = null
  state.inserts = []
  state.inCalls = []
})

describe('buildCandidateList', () => {
  it('löst einen {lex:}-Tag gegen einen bereits veröffentlichten Begriff auf, ohne neu zu generieren', async () => {
    const { buildCandidateList } = await import('@/lib/glossary/candidates')
    const published = [{ slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] }]
    const result = await buildCandidateList(makeSupabase() as never, published, ['Inferenz'], [], [])
    expect(result).toEqual([
      { slug: 'inferenz', name: 'Inferenz', origin: 'tag', matchedText: null, isNewlyGenerated: false },
    ])
    expect(mocks.generateTermContent).not.toHaveBeenCalled()
  })

  it('generiert und legt einen Begriff aus einem {lex:}-Tag als draft an, wenn er noch nicht existiert', async () => {
    mocks.generateTermContent.mockResolvedValue(fixtureGenerated())
    const { buildCandidateList } = await import('@/lib/glossary/candidates')
    const result = await buildCandidateList(makeSupabase() as never, [], ['Mixture of Experts'], [], [])
    expect(result).toEqual([
      { slug: 'mixture-of-experts', name: 'Mixture of Experts', origin: 'tag', matchedText: null, isNewlyGenerated: true },
    ])
    expect(mocks.generateTermContent).toHaveBeenCalledWith('Mixture of Experts')
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toMatchObject({ table: 'glossary_terms', slug: 'mixture-of-experts', status: 'draft' })
  })

  it('übernimmt bei Matcher-Treffern die matchedText aus dem Mention und den Namen aus der Begriffsliste', async () => {
    const { buildCandidateList } = await import('@/lib/glossary/candidates')
    const published = [{ slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] }]
    const result = await buildCandidateList(
      makeSupabase() as never, published, [], [{ slug: 'inferenz', matchedText: 'Inferenzkosten' }], [],
    )
    expect(result).toEqual([
      { slug: 'inferenz', name: 'Inferenz', origin: 'match', matchedText: 'Inferenzkosten', isNewlyGenerated: false },
    ])
  })

  it('generiert einen neuen Begriff aus dem LLM-Vorschlag (origin=new) und legt ihn als draft an', async () => {
    mocks.generateTermContent.mockResolvedValue(fixtureGenerated())
    const { buildCandidateList } = await import('@/lib/glossary/candidates')
    const result = await buildCandidateList(makeSupabase() as never, [], [], [], ['Mixture of Experts'])
    expect(result).toEqual([
      { slug: 'mixture-of-experts', name: 'Mixture of Experts', origin: 'new', matchedText: null, isNewlyGenerated: true },
    ])
    expect(state.inserts).toHaveLength(1)
  })

  it('Kosten-Bremse: generiert einen LLM-Vorschlag NICHT neu, wenn bereits ein Draft mit passendem Namen existiert', async () => {
    state.draftRows = [{ slug: 'mixture-of-experts', canonical_name: 'Mixture of Experts', aliases: ['MoE'] }]
    const { buildCandidateList } = await import('@/lib/glossary/candidates')
    const result = await buildCandidateList(makeSupabase() as never, [], [], [], ['Mixture of Experts'])
    expect(result).toEqual([
      { slug: 'mixture-of-experts', name: 'Mixture of Experts', origin: 'new', matchedText: null, isNewlyGenerated: false },
    ])
    expect(mocks.generateTermContent).not.toHaveBeenCalled()
    expect(state.inserts).toHaveLength(0)
  })

  it('Regression (Review-Fix 1): fragt beim Namens-Abgleich draft UND hidden ab, nicht nur draft', async () => {
    // Vorher: .eq('status','draft') — ein zuvor versteckter (hidden) Begriff
    // war damit in KEINER Liste (getMatcherTerms liefert nur published). Das
    // LLM konnte ihn erneut vorschlagen, generateTermContent lief erneut (voller
    // Kosten-Call), und der Insert verletzte glossary_terms.slug UNIQUE, wurde
    // von tryGenerateDraft abgefangen — der Kandidat verschwand lautlos, jedes
    // Mal aufs Neue. Diese Assertion prüft die Query selbst (der Chain-Stub
    // ignoriert Filterwerte bei der Datenauflösung, s. state.inCalls-Kommentar).
    const { buildCandidateList } = await import('@/lib/glossary/candidates')
    await buildCandidateList(makeSupabase() as never, [], [], [], [])
    expect(state.inCalls).toContainEqual(['status', ['draft', 'hidden']])
  })

  it('Regression (Review-Fix 1): generiert einen LLM-Vorschlag NICHT neu, wenn bereits ein hidden-Begriff mit passendem Namen existiert', async () => {
    state.draftRows = [{ slug: 'mixture-of-experts', canonical_name: 'Mixture of Experts', aliases: ['MoE'] }]
    const { buildCandidateList } = await import('@/lib/glossary/candidates')
    const result = await buildCandidateList(makeSupabase() as never, [], [], [], ['Mixture of Experts'])
    expect(result).toEqual([
      { slug: 'mixture-of-experts', name: 'Mixture of Experts', origin: 'new', matchedText: null, isNewlyGenerated: false },
    ])
    expect(mocks.generateTermContent).not.toHaveBeenCalled()
    expect(state.inserts).toHaveLength(0)
  })

  it('Regression (Review-Minor): protokolliert einen Fehler, wenn das Laden bestehender Begriffe fehlschlägt, statt ihn zu verschlucken', async () => {
    state.draftRowsError = { message: 'DB nicht erreichbar' }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { buildCandidateList } = await import('@/lib/glossary/candidates')
    await buildCandidateList(makeSupabase() as never, [], [], [], [])
    expect(errSpy.mock.calls.some((call) => call.some((arg) => String(arg).includes('DB nicht erreichbar')))).toBe(true)
    errSpy.mockRestore()
  })

  it('generiert eine Illustration nur, wenn needsIllustration=true ist', async () => {
    mocks.generateTermContent.mockResolvedValue(fixtureGenerated({ needsIllustration: false }))
    const { buildCandidateList } = await import('@/lib/glossary/candidates')
    await buildCandidateList(makeSupabase() as never, [], [], [], ['Mixture of Experts'])
    expect(mocks.generateGlossaryIllustration).not.toHaveBeenCalled()
    expect(state.inserts[0].illustration_url).toBeNull()
  })

  it('lädt eine Illustration hoch und setzt illustration_url, wenn needsIllustration=true ist', async () => {
    mocks.generateTermContent.mockResolvedValue(
      fixtureGenerated({ needsIllustration: true, illustrationAlt: 'Schema der Experten-Auswahl' }),
    )
    mocks.generateGlossaryIllustration.mockResolvedValue({ success: true, imageBase64: 'ZmFrZQ==' })
    mocks.uploadGlossaryIllustration.mockResolvedValue('https://blob.example/glossary/mixture-of-experts.png')
    const { buildCandidateList } = await import('@/lib/glossary/candidates')
    await buildCandidateList(makeSupabase() as never, [], [], [], ['Mixture of Experts'])
    expect(state.inserts[0].illustration_url).toBe('https://blob.example/glossary/mixture-of-experts.png')
    expect(state.inserts[0].illustration_alt).toBe('Schema der Experten-Auswahl')
  })

  it('verliert den Kandidaten NICHT, wenn der Illustration-Upload wirft (uploadGlossaryIllustration throws)', async () => {
    mocks.generateTermContent.mockResolvedValue(fixtureGenerated({ needsIllustration: true, illustrationAlt: 'Alt' }))
    mocks.generateGlossaryIllustration.mockResolvedValue({ success: true, imageBase64: 'ZmFrZQ==' })
    mocks.uploadGlossaryIllustration.mockRejectedValue(new Error('blob store down'))
    const { buildCandidateList } = await import('@/lib/glossary/candidates')
    const result = await buildCandidateList(makeSupabase() as never, [], [], [], ['Mixture of Experts'])
    expect(result).toEqual([
      { slug: 'mixture-of-experts', name: 'Mixture of Experts', origin: 'new', matchedText: null, isNewlyGenerated: true },
    ])
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0].illustration_url).toBeNull()
  })

  it('verwirft nur den einen fehlgeschlagenen Kandidaten, nicht die ganze Liste', async () => {
    mocks.generateTermContent.mockImplementation(async (name: string) => {
      if (name === 'Bricht ab') throw new Error('LLM-Fehler')
      return fixtureGenerated({ slug: 'ok-begriff', canonicalName: 'OK Begriff' })
    })
    const { buildCandidateList } = await import('@/lib/glossary/candidates')
    const result = await buildCandidateList(makeSupabase() as never, [], [], [], ['Bricht ab', 'OK Begriff'])
    expect(result).toEqual([
      { slug: 'ok-begriff', name: 'OK Begriff', origin: 'new', matchedText: null, isNewlyGenerated: true },
    ])
  })

  it('Kollision: derselbe Slug aus Tag UND Matcher wird nur einmal aufgenommen, Tag gewinnt', async () => {
    const published = [{ slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] }]
    const { buildCandidateList } = await import('@/lib/glossary/candidates')
    const result = await buildCandidateList(
      makeSupabase() as never, published, ['Inferenz'], [{ slug: 'inferenz', matchedText: 'Inferenzkosten' }], [],
    )
    expect(result).toHaveLength(1)
    expect(result[0].origin).toBe('tag')
  })
})
