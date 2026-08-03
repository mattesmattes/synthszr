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
  it('berücksichtigt nur visible und chartable Produkte', async () => {
    state.candidateRows = CANDIDATES
    mocks.create.mockResolvedValueOnce(toolUse({ assignments: [{ product_id: 'p1', relevance: 0.9 }] }))
    const { assignProducts } = await import('@/lib/glossary/products')
    const written = await assignProducts('term-1', 'Mixture of Experts', 'Kurzfassung.')

    expect(written).toBe(1)
    const metricsCalls = state.calls.filter((c) => c.table === 'product_metrics')
    expect(metricsCalls).toContainEqual({ table: 'product_metrics', method: 'eq', args: ['chartable', true] })
    expect(metricsCalls).toContainEqual({ table: 'product_metrics', method: 'eq', args: ['products.visibility_status', 'visible'] })
    expect(metricsCalls).toContainEqual({ table: 'product_metrics', method: 'gte', args: ['mention_count', 2] })
    expect(state.upserts).toEqual([
      { table: 'glossary_term_products', rows: [{ term_id: 'term-1', product_id: 'p1', relevance: 0.9, source: 'llm' }] },
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
})
