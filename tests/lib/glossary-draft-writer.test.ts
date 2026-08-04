/**
 * generateAndInsertDraft — erzeugt EINEN Lexikon-Begriff (Inhalt + optional
 * Illustration + Produkt-Zuordnung) und legt ihn als draft an.
 *
 * Lag bis 2026-08-04 als private `tryGenerateDraft` in candidates.ts; diese
 * Tests sind von tests/lib/glossary-candidates.test.ts hierher gewandert, weil
 * die Funktion mit der Entkopplung (Befund B) aus der lexicon-Phase in die
 * Freigabe gezogen ist. Die geprüften Eigenschaften sind unverändert — es ist
 * dieselbe Verdrahtung, nur an ihrem neuen Ort.
 *
 * Mock-Strategie wie zuvor: generateTermContent / generateGlossaryIllustration /
 * uploadGlossaryIllustration / assignProducts sind gemockt (jeweils in eigenen
 * Testdateien gegen echtes Verhalten geprüft) — hier geht es um die
 * Verdrahtung und darum, dass ein Teilfehler den Begriff nicht kostet.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { GeneratedTerm } from '@/lib/glossary/generate'

const mocks = vi.hoisted(() => ({
  generateTermContent: vi.fn(),
  generateGlossaryIllustration: vi.fn(),
  uploadGlossaryIllustration: vi.fn(),
  assignProducts: vi.fn(),
}))

vi.mock('@/lib/glossary/generate', () => ({
  generateTermContent: mocks.generateTermContent,
}))

vi.mock('@/lib/gemini/image-generator', () => ({
  generateGlossaryIllustration: mocks.generateGlossaryIllustration,
  uploadGlossaryIllustration: mocks.uploadGlossaryIllustration,
}))

vi.mock('@/lib/glossary/products', () => ({
  assignProducts: mocks.assignProducts,
}))

const state = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  insertError: null as { message: string } | null,
}))

function makeSupabase() {
  return {
    from: vi.fn(() => {
      const chain: any = {}
      let payload: Record<string, unknown> | null = null
      chain.insert = vi.fn((p: Record<string, unknown>) => { state.inserts.push(p); payload = p; return chain })
      chain.select = vi.fn(() => chain)
      chain.single = vi.fn(async () => ({
        data: state.insertError || !payload ? null : { id: `id-${payload.slug}` },
        error: state.insertError,
      }))
      return chain
    }),
  }
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
  mocks.assignProducts.mockReset()
  state.inserts = []
  state.insertError = null
})

describe('generateAndInsertDraft', () => {
  it('legt den generierten Begriff als draft an und gibt ihn zurück', async () => {
    mocks.generateTermContent.mockResolvedValue(fixtureGenerated())
    const { generateAndInsertDraft } = await import('@/lib/glossary/draft-writer')
    const result = await generateAndInsertDraft(makeSupabase() as never, 'Mixture of Experts')
    expect(result).toEqual({
      slug: 'mixture-of-experts',
      canonicalName: 'Mixture of Experts',
      aliases: ['MoE'],
      summary: fixtureGenerated().summary,
    })
    expect(mocks.generateTermContent).toHaveBeenCalledWith('Mixture of Experts')
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toMatchObject({ slug: 'mixture-of-experts', status: 'draft' })
  })

  it('nutzt den forcedSlug statt des vom Modell abgeleiteten Slugs', async () => {
    // Der Kandidat trägt seinen Slug schon in pending_glossary_terms. Würde hier
    // der LLM-Slug gewinnen, entstünde der Begriff unter einer anderen Adresse
    // als der bestätigte Kandidat — die Freigabe fände ihn nicht wieder.
    mocks.generateTermContent.mockResolvedValue(fixtureGenerated({ canonicalName: 'Mixture of Experts' }))
    const { generateAndInsertDraft } = await import('@/lib/glossary/draft-writer')
    const result = await generateAndInsertDraft(makeSupabase() as never, 'MoE', 'moe')
    expect(result?.slug).toBe('moe')
    expect(state.inserts[0].slug).toBe('moe')
    // Der Anzeigename bleibt der normalisierte aus der Generierung — nur der
    // Schlüssel ist festgenagelt.
    expect(state.inserts[0].canonical_name).toBe('Mixture of Experts')
  })

  it('generiert eine Illustration nur, wenn needsIllustration=true ist', async () => {
    mocks.generateTermContent.mockResolvedValue(fixtureGenerated({ needsIllustration: false }))
    const { generateAndInsertDraft } = await import('@/lib/glossary/draft-writer')
    await generateAndInsertDraft(makeSupabase() as never, 'Mixture of Experts')
    expect(mocks.generateGlossaryIllustration).not.toHaveBeenCalled()
    expect(state.inserts[0].illustration_url).toBeNull()
  })

  it('lädt eine Illustration hoch und setzt illustration_url, wenn needsIllustration=true ist', async () => {
    mocks.generateTermContent.mockResolvedValue(
      fixtureGenerated({ needsIllustration: true, illustrationAlt: 'Schema der Experten-Auswahl' }),
    )
    mocks.generateGlossaryIllustration.mockResolvedValue({ success: true, imageBase64: 'ZmFrZQ==' })
    mocks.uploadGlossaryIllustration.mockResolvedValue('https://blob.example/glossary/mixture-of-experts.png')
    const { generateAndInsertDraft } = await import('@/lib/glossary/draft-writer')
    await generateAndInsertDraft(makeSupabase() as never, 'Mixture of Experts')
    expect(state.inserts[0].illustration_url).toBe('https://blob.example/glossary/mixture-of-experts.png')
    expect(state.inserts[0].illustration_alt).toBe('Schema der Experten-Auswahl')
  })

  it('verliert den Begriff NICHT, wenn der Illustration-Upload wirft', async () => {
    mocks.generateTermContent.mockResolvedValue(fixtureGenerated({ needsIllustration: true, illustrationAlt: 'Alt' }))
    mocks.generateGlossaryIllustration.mockResolvedValue({ success: true, imageBase64: 'ZmFrZQ==' })
    mocks.uploadGlossaryIllustration.mockRejectedValue(new Error('blob store down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { generateAndInsertDraft } = await import('@/lib/glossary/draft-writer')
    const result = await generateAndInsertDraft(makeSupabase() as never, 'Mixture of Experts')
    expect(result?.slug).toBe('mixture-of-experts')
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0].illustration_url).toBeNull()
    errSpy.mockRestore()
  })

  it('gibt null zurück statt zu werfen, wenn die Generierung fehlschlägt', async () => {
    mocks.generateTermContent.mockRejectedValue(new Error('LLM-Fehler'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { generateAndInsertDraft } = await import('@/lib/glossary/draft-writer')
    const result = await generateAndInsertDraft(makeSupabase() as never, 'Bricht ab')
    expect(result).toBeNull()
    expect(state.inserts).toHaveLength(0)
    errSpy.mockRestore()
  })

  it('gibt null zurück, wenn der Insert fehlschlägt (z.B. Slug-Kollision)', async () => {
    mocks.generateTermContent.mockResolvedValue(fixtureGenerated())
    state.insertError = { message: 'duplicate key value violates unique constraint' }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { generateAndInsertDraft } = await import('@/lib/glossary/draft-writer')
    const result = await generateAndInsertDraft(makeSupabase() as never, 'Mixture of Experts')
    expect(result).toBeNull()
    errSpy.mockRestore()
  })

  it('verdrahtet: der neue Begriff bekommt Produkte zugeordnet', async () => {
    mocks.generateTermContent.mockResolvedValue(fixtureGenerated())
    mocks.assignProducts.mockResolvedValue(3)
    const { generateAndInsertDraft } = await import('@/lib/glossary/draft-writer')
    await generateAndInsertDraft(makeSupabase() as never, 'Mixture of Experts')
    // Name und summary kommen aus der Generierung, nicht aus dem Eingabe-Namen.
    expect(mocks.assignProducts).toHaveBeenCalledWith(
      'id-mixture-of-experts', 'Mixture of Experts', fixtureGenerated().summary,
    )
  })

  it('verdrahtet: ein Fehler in assignProducts verwirft den Begriff nicht', async () => {
    mocks.generateTermContent.mockResolvedValue(fixtureGenerated())
    mocks.assignProducts.mockRejectedValue(new Error('LLM-Fehler'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { generateAndInsertDraft } = await import('@/lib/glossary/draft-writer')
    const result = await generateAndInsertDraft(makeSupabase() as never, 'Mixture of Experts')
    expect(result?.slug).toBe('mixture-of-experts')
    expect(state.inserts).toHaveLength(1)
    errSpy.mockRestore()
  })
})
