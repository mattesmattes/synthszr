/**
 * Wöchentlicher News-Refresh fürs Fachbegriff-Lexikon (Task 14, Design-Spec
 * §F): der Cron ruft match_glossary_news pro Begriff auf und ersetzt
 * glossary_term_news für diesen Begriff.
 *
 * Der Fake-Supabase-Client führt für glossary_term_news einen echten
 * In-Memory-Store (nicht nur eine Zusage, egal welche Argumente kommen) —
 * genau das deckt die "ersetzt bestehende Zeilen"-Behauptung ab: ein
 * Mock, der bei JEDEM insert()-Aufruf `{ error: null }` zurückgibt, würde
 * auch dann grün sein, wenn alte Zeilen liegen blieben. Hier wird
 * tatsächlich geprüft, dass nach dem Lauf NUR die neuen Treffer im Store
 * stehen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const CRON_SECRET = 'glossary-news-cron-secret'

interface TermRow {
  id: string
  canonical_name: string
  summary: string
  embedding: string | null
  news_refreshed_at: string | null
}

interface NewsMatch {
  id: string
  // Fixture-Titel müssen wie echte Schlagzeilen aussehen: looksLikeHeadline
  // (lib/glossary/news.ts) verwirft Fragmente unter 25 Zeichen oder mit weniger
  // als 4 Wörtern. Kürzt man sie hier, filtert der Code sie weg und die Tests
  // prüfen ins Leere, obwohl es um Ersetzen/Kappung geht, nicht um Titelqualität.
  title: string
  source_url: string
  published_at: string | null
  similarity: number
}

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  generateEmbedding: vi.fn(),
  getModelForUseCase: vi.fn(async () => 'claude-haiku-4-5-20251001'),
  createAdminClient: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.anthropicCreate }
  },
}))
vi.mock('@/lib/embeddings/generator', () => ({
  generateEmbedding: mocks.generateEmbedding,
}))
vi.mock('@/lib/ai/model-config', () => ({
  getModelForUseCase: mocks.getModelForUseCase,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))

/** Baut einen Fake-Client mit echtem In-Memory-Store für glossary_term_news
 *  (statt einer Zusage, die unabhängig von den Argumenten grün wäre) und
 *  einem konfigurierbaren RPC-Ergebnis pro Aufruf. */
function fakeSupabase(config: {
  terms: TermRow[]
  rpcResult: (params: unknown) => { data: NewsMatch[] | null; error: { message: string; code?: string } | null }
  /** Vorbelegter Bestand, um "ersetzt alte Zeilen" beweisbar zu machen. */
  seedNews?: Record<string, Array<{ repo_item_id: string }>>
}) {
  const newsStore = new Map<string, Array<{ term_id: string; repo_item_id: string; [k: string]: unknown }>>()
  for (const [termId, rows] of Object.entries(config.seedNews ?? {})) {
    newsStore.set(termId, rows.map((r) => ({ term_id: termId, ...r })))
  }

  const calls = {
    rpcParams: [] as Array<Record<string, unknown>>,
    embeddingUpdates: [] as Array<{ id: string; embedding: string }>,
    refreshedAtUpdates: [] as string[],
  }

  const deleteEq = vi.fn((_col: string, termId: string) => {
    newsStore.set(termId, [])
    return Promise.resolve({ error: null })
  })
  const insert = vi.fn((rows: Array<{ term_id: string; repo_item_id: string; [k: string]: unknown }>) => {
    for (const row of rows) {
      const existing = newsStore.get(row.term_id) ?? []
      existing.push(row)
      newsStore.set(row.term_id, existing)
    }
    return Promise.resolve({ error: null })
  })

  const client = {
    from(table: string) {
      if (table === 'glossary_terms') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: config.terms, error: null }),
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              if ('embedding' in payload) calls.embeddingUpdates.push({ id, embedding: payload.embedding as string })
              if ('news_refreshed_at' in payload) calls.refreshedAtUpdates.push(id)
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      if (table === 'glossary_term_news') {
        return { delete: () => ({ eq: deleteEq }), insert }
      }
      throw new Error(`Unerwartete Tabelle im Test-Mock: ${table}`)
    },
    rpc: vi.fn((_name: string, params: Record<string, unknown>) => {
      calls.rpcParams.push(params)
      const result = config.rpcResult(params)
      return Promise.resolve(result)
    }),
  }

  return { client, calls, newsStore, deleteEq, insert }
}

function req() {
  return new NextRequest('http://localhost/api/cron/glossary-news', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
}

function term(overrides: Partial<TermRow> = {}): TermRow {
  return {
    id: 't1',
    canonical_name: 'Inferenz',
    summary: 'Die Nutzung eines trainierten Modells.',
    embedding: '[0.1,0.2,0.3]',
    news_refreshed_at: null,
    ...overrides,
  }
}

function match(overrides: Partial<NewsMatch> = {}): NewsMatch {
  return {
    id: 'repo-1',
    title: 'Ein Artikel über Inferenzkosten',
    source_url: 'https://www.example.com/artikel',
    published_at: '2026-08-01T00:00:00Z',
    similarity: 0.8,
    ...overrides,
  }
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  process.env.ANTHROPIC_API_KEY = 'test-key'
  mocks.anthropicCreate.mockReset()
  mocks.anthropicCreate.mockResolvedValue({
    content: [{ type: 'tool_use', input: { sentences: ['Ein Einordnungssatz.'] } }],
  })
  mocks.generateEmbedding.mockReset()
  mocks.getModelForUseCase.mockClear()
  mocks.createAdminClient.mockReset()
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.ANTHROPIC_API_KEY
})

describe('GET /api/cron/glossary-news', () => {
  it('gibt ohne Authorization 401 zurück', async () => {
    const { GET } = await import('@/app/api/cron/glossary-news/route')
    const res = await GET(new NextRequest('http://localhost/api/cron/glossary-news'))
    expect(res.status).toBe(401)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('ersetzt bestehende News-Zeilen eines Begriffs', async () => {
    const { client, newsStore } = fakeSupabase({
      terms: [term()],
      rpcResult: () => ({
        data: [match({ id: 'repo-neu-1', title: 'Neuer Artikel über sinkende Inferenzkosten' }), match({ id: 'repo-neu-2', title: 'Zweiter Artikel über Inferenz im Betrieb' })],
        error: null,
      }),
      // Alter Bestand: zwei Zeilen, die im neuen Treffer-Set NICHT mehr vorkommen.
      seedNews: { t1: [{ repo_item_id: 'repo-alt-1' }, { repo_item_id: 'repo-alt-2' }] },
    })
    mocks.createAdminClient.mockReturnValue(client)
    mocks.anthropicCreate.mockResolvedValue({
      content: [{ type: 'tool_use', input: { sentences: ['Satz 1.', 'Satz 2.'] } }],
    })

    const { GET } = await import('@/app/api/cron/glossary-news/route')
    const res = await GET(req())
    expect(res.status).toBe(200)

    const finalRows = newsStore.get('t1') ?? []
    const ids = finalRows.map((r) => r.repo_item_id).sort()
    // Die alten Zeilen dürfen NICHT mehr da sein — ein Mock, der insert()
    // immer grün beantwortet, würde das nicht abdecken, der In-Memory-Store
    // hier schon.
    expect(ids).toEqual(['repo-neu-1', 'repo-neu-2'])
  })

  it('schreibt maximal 5 News pro Begriff', async () => {
    const sevenMatches = Array.from({ length: 7 }, (_, i) => match({ id: `repo-${i}`, title: `Ausführlicher Artikel über Inferenz Nummer ${i}` }))
    const { client, calls, newsStore } = fakeSupabase({
      terms: [term()],
      rpcResult: () => ({ data: sevenMatches, error: null }),
    })
    mocks.createAdminClient.mockReturnValue(client)
    mocks.anthropicCreate.mockResolvedValue({
      content: [{ type: 'tool_use', input: { sentences: sevenMatches.map(() => 'Satz.') } }],
    })

    const { GET } = await import('@/app/api/cron/glossary-news/route')
    const res = await GET(req())
    expect(res.status).toBe(200)

    // Die RPC wird bereits mit match_limit=5 aufgerufen (DB-seitiges Limit) ...
    expect(calls.rpcParams[0]?.match_limit).toBe(5)
    // ... UND der Code kappt defensiv nach, falls eine ältere/andere
    // Fassung der Funktion doch mehr als 5 Zeilen liefert.
    expect(newsStore.get('t1')?.length).toBe(5)
  })

  it('setzt news_refreshed_at NICHT und markiert rpcMissing, wenn die RPC noch nicht existiert (Code 42883)', async () => {
    const { client, calls } = fakeSupabase({
      terms: [term()],
      rpcResult: () => ({
        data: null,
        error: { message: 'function public.match_glossary_news(...) does not exist', code: '42883' },
      }),
    })
    mocks.createAdminClient.mockReturnValue(client)

    const { GET } = await import('@/app/api/cron/glossary-news/route')
    const res = await GET(req())

    // Eine fehlende Migration darf den Cron nie als Vercel-Fehler erscheinen
    // lassen — der News-Block bleibt einfach leer (Grundprinzip des
    // gesamten Features).
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rpcMissing).toBe(true)
    expect(calls.refreshedAtUpdates).toEqual([])
  })

  it('isoliert einen fehlgeschlagenen Begriff — die übrigen werden trotzdem aktualisiert (Review-Fix: Per-Item-Isolation)', async () => {
    // Regressionstest für den Critical-Fund: ein `break` bei JEDEM RPC-Fehler
    // hätte hier t3 nie erreicht. Nur t2 bekommt einen transienten Fehler
    // OHNE "Funktion existiert nicht"-Code — t1 und t3 müssen trotzdem
    // durchlaufen, und rpcMissing muss false bleiben (kein Migrations-Problem).
    const terms = [
      term({ id: 't1', embedding: '[1,1,1]' }),
      term({ id: 't2', embedding: '[2,2,2]' }),
      term({ id: 't3', embedding: '[3,3,3]' }),
    ]
    const { client, calls, newsStore } = fakeSupabase({
      terms,
      rpcResult: (params) => {
        const embedding = (params as { query_embedding: number[] }).query_embedding
        if (JSON.stringify(embedding) === JSON.stringify([2, 2, 2])) {
          return { data: null, error: { message: 'connection terminated unexpectedly', code: '08006' } }
        }
        return { data: [match()], error: null }
      },
    })
    mocks.createAdminClient.mockReturnValue(client)

    const { GET } = await import('@/app/api/cron/glossary-news/route')
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.rpcMissing).toBe(false)
    expect(body.termsRefreshed).toBe(2)
    expect(calls.refreshedAtUpdates.slice().sort()).toEqual(['t1', 't3'])
    expect(newsStore.get('t1')?.length).toBe(1)
    expect(newsStore.get('t3')?.length).toBe(1)
    // t2 wurde nie geschrieben (weder gelöscht-und-leer noch befüllt) —
    // der RPC-Fehler für t2 darf gar nicht erst bis delete()/insert() kommen.
    expect(newsStore.has('t2')).toBe(false)
  })

  it('generiert ein fehlendes Embedding aus canonical_name + summary und persistiert es', async () => {
    mocks.generateEmbedding.mockResolvedValue([0.4, 0.5, 0.6])
    const { client, calls } = fakeSupabase({
      terms: [term({ embedding: null })],
      rpcResult: () => ({ data: [], error: null }),
    })
    mocks.createAdminClient.mockReturnValue(client)

    const { GET } = await import('@/app/api/cron/glossary-news/route')
    const res = await GET(req())
    expect(res.status).toBe(200)

    expect(mocks.generateEmbedding).toHaveBeenCalledWith('Inferenz\n\nDie Nutzung eines trainierten Modells.')
    expect(calls.embeddingUpdates).toEqual([{ id: 't1', embedding: '[0.4,0.5,0.6]' }])
  })
})
