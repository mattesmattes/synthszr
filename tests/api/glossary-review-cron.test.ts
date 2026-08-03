/**
 * Aktualitätsprüfung fürs Fachbegriff-Lexikon (Task 17, Design-Spec §I): der
 * tägliche Cron nimmt einen Batch von 10 Begriffen (nach `last_reviewed_at`
 * aufsteigend) und lässt ein LLM anhand der aktuellen News (glossary_term_news,
 * Task 14) beurteilen, ob der Erklärungstext noch stimmt.
 *
 * - unverändert  → review_state='ok', last_reviewed_at=now(), body bleibt gleich
 * - veraltet     → neuer Text nach pending_body, review_state='revision_pending',
 *                   body bleibt UNVERÄNDERT (Freigabe folgt im Admin, Task 17 Step 4)
 *
 * Der Fake-Supabase-Client zeichnet jeden update()-Aufruf mit seinem
 * vollständigen Payload auf (nicht nur eine pauschale Zusage) — das ist die
 * einzige Art, "body bleibt unverändert" UND "last_reviewed_at wird bei einer
 * Revision NICHT gesetzt" wirklich zu beweisen statt zu behaupten.
 *
 * assignProducts (Task 15) wird gemockt wie in tests/lib/glossary-candidates.test.ts
 * — hier geht es um die Verdrahtung (ZUSATZ aus der Task-15-Vorabprüfung: pro
 * geprüftem Begriff aufgerufen, Fehler brechen den Lauf nicht ab), nicht um
 * dessen eigenes Verhalten (das deckt tests/lib/glossary-products.test.ts ab).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const CRON_SECRET = 'glossary-review-cron-secret'

interface TermRow {
  id: string
  slug: string
  canonical_name: string
  summary: string
  body: unknown
  last_reviewed_at: string | null
}

interface NewsRow {
  title: string
  context_sentence: string | null
  published_at: string | null
}

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  getModelForUseCase: vi.fn(async () => 'claude-sonnet-5'),
  createAdminClient: vi.fn(),
  assignProducts: vi.fn(async (_termId: string, _termName: string, _summary: string) => 0),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.anthropicCreate }
  },
}))
vi.mock('@/lib/ai/model-config', () => ({
  getModelForUseCase: mocks.getModelForUseCase,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))
vi.mock('@/lib/glossary/products', () => ({
  assignProducts: mocks.assignProducts,
}))

/** Baut einen Fake-Client mit einem echten Aufzeichnungs-Store für
 *  update()-Aufrufe auf glossary_terms (statt einer pauschalen { error: null }
 *  Zusage) — genau das deckt "body bleibt unverändert" und "last_reviewed_at
 *  wird nur im ok-Zweig gesetzt" beweisbar ab. */
function fakeSupabase(config: {
  terms: TermRow[]
  news?: Record<string, NewsRow[]>
  updateErrorFor?: Set<string>
  /** Simuliert einen Query-Fehler beim News-Read für bestimmte Begriffe
   *  (Important 2 — unterscheidbar von "keine News vorhanden" = leeres Array). */
  newsErrorFor?: Set<string>
}) {
  const newsByTerm = config.news ?? {}
  const calls = {
    limitArg: undefined as number | undefined,
    neqArgs: [] as Array<[string, unknown]>,
    updates: [] as Array<{ id: string; payload: Record<string, unknown> }>,
    newsQueriedFor: [] as string[],
  }

  const termsChain = {
    select: () => termsChain,
    eq: () => termsChain,
    neq: (col: string, val: unknown) => {
      calls.neqArgs.push([col, val])
      return termsChain
    },
    order: () => termsChain,
    limit: (n: number) => {
      calls.limitArg = n
      return Promise.resolve({ data: config.terms, error: null })
    },
  }

  const client = {
    from(table: string) {
      if (table === 'glossary_terms') {
        return {
          select: termsChain.select,
          update: (payload: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              calls.updates.push({ id, payload })
              if (config.updateErrorFor?.has(id)) {
                return Promise.resolve({ error: { message: 'db down' } })
              }
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      if (table === 'glossary_term_news') {
        return {
          select: () => ({
            eq: (_col: string, termId: string) => {
              calls.newsQueriedFor.push(termId)
              return {
                order: () => {
                  if (config.newsErrorFor?.has(termId)) {
                    return Promise.resolve({ data: null, error: { message: 'db down' } })
                  }
                  return Promise.resolve({ data: newsByTerm[termId] ?? [], error: null })
                },
              }
            },
          }),
        }
      }
      throw new Error(`Unerwartete Tabelle im Test-Mock: ${table}`)
    },
  }

  return { client, calls }
}

function req() {
  return new NextRequest('http://localhost/api/cron/glossary-review', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
}

function term(overrides: Partial<TermRow> = {}): TermRow {
  return {
    id: 't1',
    slug: 'inferenz',
    canonical_name: 'Inferenz',
    summary: 'Die Nutzung eines trainierten Modells.',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alter Text.' }] }] },
    last_reviewed_at: null,
    ...overrides,
  }
}

/** Antwort für "Text ist noch aktuell". */
function okResponse() {
  return { content: [{ type: 'tool_use', input: { outdated: false, reasoning: 'passt noch' } }] }
}

/** Antwort für "Text ist veraltet", mit einem neuen Blocktext. */
function outdatedResponse(text = 'Neuer, aktualisierter Text.') {
  return {
    content: [{
      type: 'tool_use',
      input: {
        outdated: true,
        blocks: [{ type: 'paragraph', text }],
        reasoning: 'neue Entwicklung macht den Text unvollständig',
      },
    }],
  }
}

/** Antwort, die ReviewSchema NICHT parsen kann (outdated fehlt) — simuliert
 *  eine unparsbare Modellantwort (Important 3, deterministischer Defekt). */
function invalidToolResponse() {
  return { content: [{ type: 'tool_use', input: { reasoning: 'ohne outdated-Feld' } }] }
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  process.env.ANTHROPIC_API_KEY = 'test-key'
  mocks.anthropicCreate.mockReset()
  mocks.anthropicCreate.mockResolvedValue(okResponse())
  mocks.getModelForUseCase.mockClear()
  mocks.createAdminClient.mockReset()
  mocks.assignProducts.mockReset()
  mocks.assignProducts.mockResolvedValue(0)
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.ANTHROPIC_API_KEY
})

describe('GET /api/cron/glossary-review', () => {
  it('gibt ohne Authorization 401 zurück', async () => {
    const { GET } = await import('@/app/api/cron/glossary-review/route')
    const res = await GET(new NextRequest('http://localhost/api/cron/glossary-review'))
    expect(res.status).toBe(401)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('schreibt eine Revision nach pending_body, ohne body zu ändern', async () => {
    const { client, calls } = fakeSupabase({ terms: [term()] })
    mocks.createAdminClient.mockReturnValue(client)
    mocks.anthropicCreate.mockResolvedValue(outdatedResponse('Frisch überarbeiteter Absatz.'))

    const { GET } = await import('@/app/api/cron/glossary-review/route')
    const res = await GET(req())
    expect(res.status).toBe(200)

    expect(calls.updates).toHaveLength(1)
    const { payload } = calls.updates[0]
    expect(payload.review_state).toBe('revision_pending')
    expect(payload).not.toHaveProperty('body')
    expect(payload).not.toHaveProperty('last_reviewed_at')
    expect(payload.pending_body).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Frisch überarbeiteter Absatz.' }] }],
    })
  })

  it('setzt review_state=ok und last_reviewed_at, wenn der Text noch aktuell ist', async () => {
    const { client, calls } = fakeSupabase({ terms: [term()] })
    mocks.createAdminClient.mockReturnValue(client)
    mocks.anthropicCreate.mockResolvedValue(okResponse())

    const { GET } = await import('@/app/api/cron/glossary-review/route')
    const res = await GET(req())
    expect(res.status).toBe(200)

    expect(calls.updates).toHaveLength(1)
    const { payload } = calls.updates[0]
    expect(payload.review_state).toBe('ok')
    expect(payload).not.toHaveProperty('pending_body')
    expect(payload).not.toHaveProperty('body')
    expect(typeof payload.last_reviewed_at).toBe('string')
  })

  it('verarbeitet maximal 10 Begriffe pro Lauf', async () => {
    const { client, calls } = fakeSupabase({ terms: [term()] })
    mocks.createAdminClient.mockReturnValue(client)

    const { GET } = await import('@/app/api/cron/glossary-review/route')
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(calls.limitArg).toBe(10)
  })

  it('schließt Begriffe mit einer bereits offenen Revision von der Auswahl aus', async () => {
    // Ein Begriff mit review_state='revision_pending' wartet auf eine
    // Admin-Entscheidung — ein erneuter Cron-Lauf darf pending_body nicht
    // klammheimlich mit einem zweiten Vorschlag überschreiben, bevor der erste
    // gesehen wurde.
    const { client, calls } = fakeSupabase({ terms: [term()] })
    mocks.createAdminClient.mockReturnValue(client)

    const { GET } = await import('@/app/api/cron/glossary-review/route')
    await GET(req())
    expect(calls.neqArgs).toContainEqual(['review_state', 'revision_pending'])
  })

  it('gibt auch bei einem Fehler in einem Begriff 200 zurück und verarbeitet die übrigen (Per-Item-Isolation)', async () => {
    const terms = [
      term({ id: 't1', slug: 'begriff-1', canonical_name: 'Begriff Eins' }),
      term({ id: 't2', slug: 'fehlerbegriff', canonical_name: 'Fehlerbegriff' }),
      term({ id: 't3', slug: 'begriff-drei', canonical_name: 'Begriff Drei' }),
    ]
    const { client, calls } = fakeSupabase({ terms })
    mocks.createAdminClient.mockReturnValue(client)
    mocks.anthropicCreate.mockImplementation(async (params: { messages: Array<{ content: string }> }) => {
      const content = params.messages[0].content
      if (content.includes('Fehlerbegriff')) throw new Error('LLM zeitweise nicht erreichbar')
      return okResponse()
    })

    const { GET } = await import('@/app/api/cron/glossary-review/route')
    const res = await GET(req())
    expect(res.status).toBe(200)

    // t2 (Fehlerbegriff) darf keinen update()-Aufruf ausgelöst haben, t1 und
    // t3 aber schon — sonst hätte ein `break` beim ersten Fehler wie in Task 14
    // die übrigen Begriffe gar nicht mehr erreicht.
    const updatedIds = calls.updates.map((u) => u.id).sort()
    expect(updatedIds).toEqual(['t1', 't3'])

    const body = await res.json()
    expect(body.termsReviewed).toBe(2)
  })

  it('ruft assignProducts pro erfolgreich geprüftem Begriff auf', async () => {
    const terms = [term({ id: 't1', canonical_name: 'Inferenz', summary: 'Kurzfassung.' })]
    const { client } = fakeSupabase({ terms })
    mocks.createAdminClient.mockReturnValue(client)

    const { GET } = await import('@/app/api/cron/glossary-review/route')
    await GET(req())

    expect(mocks.assignProducts).toHaveBeenCalledWith('t1', 'Inferenz', 'Kurzfassung.')
  })

  it('bricht den Lauf nicht ab, wenn assignProducts für einen Begriff fehlschlägt (ZUSATZ Per-Item-Isolation)', async () => {
    const terms = [
      term({ id: 't1', slug: 'begriff-1', canonical_name: 'Begriff Eins' }),
      term({ id: 't2', slug: 'begriff-zwei', canonical_name: 'Begriff Zwei' }),
    ]
    const { client, calls } = fakeSupabase({ terms })
    mocks.createAdminClient.mockReturnValue(client)
    mocks.assignProducts.mockImplementation(async (_id: string, name: string) => {
      if (name === 'Begriff Eins') throw new Error('assignProducts kaputt')
      return 0
    })

    const { GET } = await import('@/app/api/cron/glossary-review/route')
    const res = await GET(req())
    expect(res.status).toBe(200)

    // Trotz des assignProducts-Fehlers für t1 muss t1 SELBST als geprüft
    // gelten (die Review-Schreibung ist unabhängig von der Produkt-Zuordnung),
    // und t2 muss ebenfalls durchlaufen sein.
    const updatedIds = calls.updates.map((u) => u.id).sort()
    expect(updatedIds).toEqual(['t1', 't2'])
    const body = await res.json()
    expect(body.termsReviewed).toBe(2)
  })

  it('gibt die aktuellen News als Kontext an den LLM-Call weiter', async () => {
    const { client } = fakeSupabase({
      terms: [term()],
      news: { t1: [{ title: 'Neuer Inferenz-Chip vorgestellt', context_sentence: 'Senkt die Inferenzkosten deutlich.', published_at: '2026-08-01T00:00:00Z' }] },
    })
    mocks.createAdminClient.mockReturnValue(client)

    const { GET } = await import('@/app/api/cron/glossary-review/route')
    await GET(req())

    const promptContent = mocks.anthropicCreate.mock.calls[0][0].messages[0].content as string
    expect(promptContent).toContain('Neuer Inferenz-Chip vorgestellt')
    expect(promptContent).toContain('Senkt die Inferenzkosten deutlich.')
  })

  it('schreibt bei einem News-Lesefehler KEINEN Stempel — weder ok noch flagged (Important 2)', async () => {
    // Vor dem Fix gab loadTermNews bei einem Query-Fehler `[]` zurück —
    // ununterscheidbar von "wirklich keine News" — und der Aufrufer stempelte
    // das Ergebnis trotzdem als review_state='ok' mit last_reviewed_at=now().
    const { client, calls } = fakeSupabase({
      terms: [term()],
      newsErrorFor: new Set(['t1']),
    })
    mocks.createAdminClient.mockReturnValue(client)

    const { GET } = await import('@/app/api/cron/glossary-review/route')
    const res = await GET(req())
    expect(res.status).toBe(200)

    // Kein update()-Aufruf für t1 — weder 'ok' noch 'flagged'. Ein
    // Lesefehler ist transient, der Begriff muss unverändert bleiben.
    expect(calls.updates).toHaveLength(0)
    // Ohne News-Kontext darf gar nicht erst geurteilt werden.
    expect(mocks.anthropicCreate).not.toHaveBeenCalled()
  })

  it('markiert einen Begriff mit kaputtem/fehlendem body als flagged statt abzustürzen (Important 3)', async () => {
    // extractPlainText(term.body as TipTapDoc) war ein ungeprüfter Cast auf
    // beliebiges DB-JSONB — body ist jsonb ohne NOT NULL und kann null oder
    // ein Dokument ohne content sein. Ohne Vorprüfung würde das bei JEDEM
    // Lauf identisch scheitern und den Begriff für immer an der Spitze der
    // last_reviewed_at-Sortierung halten.
    const { client, calls } = fakeSupabase({ terms: [term({ body: null })] })
    mocks.createAdminClient.mockReturnValue(client)

    const { GET } = await import('@/app/api/cron/glossary-review/route')
    const res = await GET(req())
    expect(res.status).toBe(200)

    expect(calls.updates).toHaveLength(1)
    const { payload } = calls.updates[0]
    expect(payload.review_state).toBe('flagged')
    expect(typeof payload.last_reviewed_at).toBe('string')
    // Ein Begriff mit kaputtem body wird gar nicht erst ans LLM geschickt.
    expect(mocks.anthropicCreate).not.toHaveBeenCalled()
    expect(calls.newsQueriedFor).not.toContain('t1')

    const body = await res.json()
    expect(body.termsReviewed).toBe(1)
  })

  it('markiert einen Begriff mit einem Top-Level-Node ohne content-Array als flagged (Fix-Runde 2, Important 3 vertieft)', async () => {
    // isValidTipTapDoc prüfte in der ersten Fassung nur, dass body.content ein
    // Array ist — ein Node OHNE eigenes content-Array (leerer TipTap-Absatz
    // `{"type":"paragraph"}`, ebenso horizontalRule/image) besteht diese
    // Vorprüfung trotzdem, lässt extractPlainText aber mit einer TypeError
    // abstürzen (node.content.map ist dann undefined.map). Das landet im
    // äußeren catch OHNE Stempel — dieselbe Klasse Head-of-Line-Blocking wie
    // der body=null-Fall oben, nur eine Ebene tiefer.
    const brokenBody = { type: 'doc', content: [{ type: 'paragraph' }] }
    const { client, calls } = fakeSupabase({ terms: [term({ body: brokenBody })] })
    mocks.createAdminClient.mockReturnValue(client)

    const { GET } = await import('@/app/api/cron/glossary-review/route')
    const res = await GET(req())
    expect(res.status).toBe(200)

    expect(calls.updates).toHaveLength(1)
    const { payload } = calls.updates[0]
    expect(payload.review_state).toBe('flagged')
    expect(typeof payload.last_reviewed_at).toBe('string')
    expect(mocks.anthropicCreate).not.toHaveBeenCalled()
  })

  it('markiert einen Begriff mit unparsbarer Modellantwort als flagged (Important 3)', async () => {
    const { client, calls } = fakeSupabase({ terms: [term()] })
    mocks.createAdminClient.mockReturnValue(client)
    mocks.anthropicCreate.mockResolvedValue(invalidToolResponse())

    const { GET } = await import('@/app/api/cron/glossary-review/route')
    const res = await GET(req())
    expect(res.status).toBe(200)

    expect(calls.updates).toHaveLength(1)
    const { payload } = calls.updates[0]
    expect(payload.review_state).toBe('flagged')
    expect(typeof payload.last_reviewed_at).toBe('string')
  })

  it('markiert einen Begriff mit leerer Revision (outdated=true ohne brauchbaren Text) als flagged', async () => {
    const { client, calls } = fakeSupabase({ terms: [term()] })
    mocks.createAdminClient.mockReturnValue(client)
    mocks.anthropicCreate.mockResolvedValue(outdatedResponse('   '))

    const { GET } = await import('@/app/api/cron/glossary-review/route')
    const res = await GET(req())
    expect(res.status).toBe(200)

    expect(calls.updates).toHaveLength(1)
    const { payload } = calls.updates[0]
    expect(payload.review_state).toBe('flagged')
    expect(payload).not.toHaveProperty('pending_body')
    expect(typeof payload.last_reviewed_at).toBe('string')
  })
})
