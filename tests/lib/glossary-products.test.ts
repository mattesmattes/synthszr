/**
 * Produkt-Zuordnung (Task 15): assignProducts lädt eine Kandidatenliste
 * chartbarer, sichtbarer Produkte (Join-Vorbild lib/rankings/leaderboard.ts),
 * lässt ein LLM eine Relevanz-Teilmenge auswählen und schreibt sie nach
 * glossary_term_products. Anthropic-SDK gemockt (Muster aus
 * glossary-generate.test.ts), Supabase-Chain per Hand gebaut (Muster aus
 * newsletter-access-tokens.test.ts) — die Filter selbst werden geprüft
 * (Sicherheitseigenschaft: NUR chartable+visible+minMentions darf in den
 * Prompt gelangen), nicht nur das Endergebnis.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.create }
  },
}))

vi.mock('@/lib/ai/model-config', () => ({
  getModelForUseCase: vi.fn(async () => 'claude-opus-5'),
}))

const state = vi.hoisted(() => ({
  candidateRows: [] as unknown[],
  candidateError: null as { message: string } | null,
  existingRows: [] as unknown[],
  existingError: null as { message: string } | null,
  upserts: [] as Array<{ table: string; rows: unknown }>,
  upsertError: null as { message: string } | null,
  // Zeichnet jeden Filter-Aufruf auf jeder Chain auf — die Assertion prüft
  // damit, dass die Kandidatenliste WIRKLICH nach chartable/visible/mention_count
  // filtert, nicht nur, dass irgendwelche Zeilen zurückkommen.
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}))

function makeChain(table: string) {
  const chain: Record<string, unknown> = {}
  const record = (method: string) => (...args: unknown[]) => {
    state.calls.push({ table, method, args })
    return chain
  }
  chain.select = vi.fn(record('select'))
  chain.eq = vi.fn(record('eq'))
  chain.gte = vi.fn(record('gte'))
  chain.order = vi.fn(record('order'))
  chain.limit = vi.fn(record('limit'))
  chain.upsert = vi.fn((rows: unknown) => {
    state.upserts.push({ table, rows })
    return Promise.resolve({ error: state.upsertError })
  })
  chain.then = (res: (v: unknown) => void) => {
    if (table === 'product_metrics') { res({ data: state.candidateRows, error: state.candidateError }); return }
    if (table === 'glossary_term_products') { res({ data: state.existingRows, error: state.existingError }); return }
    res({ data: [], error: null })
  }
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: vi.fn((table: string) => makeChain(table)) }),
}))

function toolUse(input: unknown) {
  return { content: [{ type: 'tool_use', input }] }
}

const CANDIDATES = [
  { mention_count: 50, products: { id: 'p1', canonical_name: 'GPT-5', vendor_namespace: 'openai' } },
  { mention_count: 10, products: { id: 'p2', canonical_name: 'Some Tool', vendor_namespace: 'acme' } },
]

beforeEach(() => {
  mocks.create.mockReset()
  state.candidateRows = []
  state.candidateError = null
  state.existingRows = []
  state.existingError = null
  state.upserts = []
  state.upsertError = null
  state.calls = []
})

describe('assignProducts', () => {
  it('berücksichtigt nur visible und chartable Produkte, kappt Halluzinationen und clamped relevance', async () => {
    state.candidateRows = CANDIDATES
    // p1 mit out-of-range relevance (muss auf 1 geclamped werden) + eine
    // vom Modell erfundene id, die NICHT aus der Kandidatenliste stammt (muss
    // verworfen werden, sonst FK-Violation beim Upsert).
    mocks.create.mockResolvedValueOnce(toolUse({
      assignments: [{ product_id: 'p1', relevance: 1.7 }, { product_id: 'p-halluziniert', relevance: 0.5 }],
    }))
    const { assignProducts } = await import('@/lib/glossary/products')
    const written = await assignProducts('term-1', 'Mixture of Experts', 'Kurzfassung.')

    expect(written).toBe(1)
    const metricsCalls = state.calls.filter((c) => c.table === 'product_metrics')
    expect(metricsCalls).toContainEqual({ table: 'product_metrics', method: 'eq', args: ['chartable', true] })
    expect(metricsCalls).toContainEqual({ table: 'product_metrics', method: 'eq', args: ['products.visibility_status', 'visible'] })
    expect(metricsCalls).toContainEqual({ table: 'product_metrics', method: 'gte', args: ['mention_count', 2] })
    // Befund 4: der Cap muss wirklich in der Query ankommen, nicht nur im Kommentar.
    expect(metricsCalls).toContainEqual({ table: 'product_metrics', method: 'order', args: ['mention_count', { ascending: false }] })
    expect(metricsCalls).toContainEqual({ table: 'product_metrics', method: 'limit', args: [300] })
    expect(state.upserts).toEqual([
      { table: 'glossary_term_products', rows: [{ term_id: 'term-1', product_id: 'p1', relevance: 1, source: 'llm' }] },
    ])
  })

  it('überschreibt manuelle Zuordnungen nicht', async () => {
    state.candidateRows = CANDIDATES
    // p1 wurde bereits von Hand zugeordnet (source='manual') — die LLM-Antwort
    // versucht trotzdem, p1 MIT einer anderen relevance zu überschreiben.
    state.existingRows = [{ product_id: 'p1', source: 'manual' }]
    mocks.create.mockResolvedValueOnce(toolUse({
      assignments: [{ product_id: 'p1', relevance: 0.95 }, { product_id: 'p2', relevance: 0.4 }],
    }))
    const { assignProducts } = await import('@/lib/glossary/products')
    const written = await assignProducts('term-1', 'Mixture of Experts', 'Kurzfassung.')

    expect(written).toBe(1)
    expect(state.upserts).toEqual([
      { table: 'glossary_term_products', rows: [{ term_id: 'term-1', product_id: 'p2', relevance: 0.4, source: 'llm' }] },
    ])
  })

  it('schreibt nichts, wenn kein Produkt passt', async () => {
    state.candidateRows = CANDIDATES
    mocks.create.mockResolvedValueOnce(toolUse({ assignments: [] }))
    const { assignProducts } = await import('@/lib/glossary/products')
    const written = await assignProducts('term-1', 'Mixture of Experts', 'Kurzfassung.')

    expect(written).toBe(0)
    expect(state.upserts).toHaveLength(0)
  })

  it('Review-Fix (Important 1): bricht ohne Schreiben ab, wenn der Bestandsabgleich für manuelle Zuordnungen fehlschlägt', async () => {
    // Vorher: ein Fehler beim Laden von glossary_term_products wurde nur
    // geloggt, manualIds blieb ein leeres Set, und der Code upsertete trotzdem
    // — genau im Fehlerfall hätte das eine echte source='manual'-Zeile mit
    // source='llm' überschrieben. Gegen den alten Code ist dieser Test rot:
    // written wäre 1 und state.upserts hätte einen Eintrag.
    state.candidateRows = CANDIDATES
    state.existingError = { message: 'DB nicht erreichbar' }
    mocks.create.mockResolvedValueOnce(toolUse({ assignments: [{ product_id: 'p1', relevance: 0.9 }] }))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { assignProducts } = await import('@/lib/glossary/products')
    const written = await assignProducts('term-1', 'Mixture of Experts', 'Kurzfassung.')

    expect(written).toBe(0)
    expect(state.upserts).toHaveLength(0)
    errSpy.mockRestore()
  })

  it('degradiert auf 0 ohne LLM-Call, wenn das Laden der Kandidatenliste fehlschlägt', async () => {
    // candidateRows bewusst NICHT leer: der Mock liefert data UND error
    // gleichzeitig zurück (wie ein echter PostgREST-Fehler es nicht täte, aber
    // genau deshalb diskriminierend für den Code) — nur wenn assignProducts
    // den error wirklich prüft (statt nur auf leere Daten zu reagieren),
    // bleibt written=0 und mocks.create unaufgerufen.
    state.candidateRows = CANDIDATES
    state.candidateError = { message: 'DB nicht erreichbar' }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { assignProducts } = await import('@/lib/glossary/products')
    const written = await assignProducts('term-1', 'Mixture of Experts', 'Kurzfassung.')

    expect(written).toBe(0)
    expect(mocks.create).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('wirft, wenn der finale Upsert fehlschlägt', async () => {
    state.candidateRows = CANDIDATES
    state.upsertError = { message: 'constraint violation' }
    mocks.create.mockResolvedValueOnce(toolUse({ assignments: [{ product_id: 'p1', relevance: 0.9 }] }))
    const { assignProducts } = await import('@/lib/glossary/products')
    await expect(assignProducts('term-1', 'Mixture of Experts', 'Kurzfassung.')).rejects.toThrow()
  })
})
