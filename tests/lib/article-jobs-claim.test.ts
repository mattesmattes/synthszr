/**
 * Hintergrund-Generierung (2026-10-19): der Server treibt den Artikel-Job, nicht
 * mehr der Browser. Dafür braucht advanceArticleJob (a) einen Compare-and-Set-
 * Claim — zwei Treiber (Minuten-Cron, 15-Minuten-Scheduler) dürfen denselben
 * Job nicht gleichzeitig vorantreiben — und (b) die Lease-Freigabe am Ende
 * jeder erfolgreichen Phase, damit der nächste Tick sofort weitermacht statt
 * sechs Minuten auf den Stale-Lease zu warten.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  planArticle: vi.fn(),
  buildSectionContext: vi.fn(),
  finalizeArticle: vi.fn(),
  selectAndEnrichItems: vi.fn(),
}))
vi.mock('@/lib/claude/ghostwriter-pipeline', () => ({
  planArticle: mocks.planArticle,
  writeSectionsBatch: vi.fn(),
  buildSectionContext: mocks.buildSectionContext,
  finalizeArticle: mocks.finalizeArticle,
}))
vi.mock('@/lib/claude/queue-article', () => ({
  selectAndEnrichItems: mocks.selectAndEnrichItems,
  toPipelineItem: vi.fn(),
  buildVocabularyContext: vi.fn(async () => ({ vocabulary: [], vocabularyContext: '' })),
}))
vi.mock('@/lib/ai/model-config', () => ({ getModelForUseCase: vi.fn(async () => 'claude-opus-5') }))
vi.mock('@/lib/images/cover-image', () => ({ generateCoverImagesForPost: vi.fn() }))
vi.mock('@/lib/stock-synthszr/warm', () => ({ ensureStockSynthszr: vi.fn() }))

const state = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  freshJob: null as Record<string, unknown> | null,
  claimRows: [{ id: 'job-1' }] as Array<{ id: string }>,
  casUpdateRows: undefined as Array<{ id: string }> | undefined,
  updates: [] as Array<Record<string, unknown>>,
  ops: [] as Array<[string, unknown[]]>,
  postOps: [] as Array<[string, unknown[]]>,
  postInserts: [] as Array<Record<string, unknown>>,
  jobInserts: [] as Array<Record<string, unknown>>,
}))

function makeChain(table: string) {
  let op = 'select'
  let selectCols = ''
  let payload: Record<string, unknown> | undefined
  const chain: Record<string, unknown> = {}
  const rec = (name: string) => vi.fn((...args: unknown[]) => {
    if (name === 'select' && typeof args[0] === 'string') selectCols = args[0]
    if (table === 'article_jobs') state.ops.push([name, args])
    if (table === 'generated_posts') state.postOps.push([name, args])
    return chain
  })
  for (const m of ['select', 'eq', 'neq', 'in', 'or', 'lt', 'order', 'limit']) chain[m] = rec(m)
  chain.update = vi.fn((p: Record<string, unknown>) => { op = 'update'; payload = p; if (table === 'article_jobs') state.updates.push(p); return chain })
  chain.insert = vi.fn((p: Record<string, unknown>) => {
    op = 'insert'
    payload = p
    if (table === 'article_jobs') state.jobInserts.push(p)
    if (table === 'generated_posts') state.postInserts.push(p)
    return chain
  })
  chain.upsert = vi.fn(async () => ({ error: null }))
  const isClaim = () => op === 'update' && payload?.status === 'processing' && typeof payload?.last_advanced_at === 'string'
  const isCasUpdate = () => op === 'update' && !isClaim() && payload && ('phase' in payload || 'status' in payload)
  const resolve = () => {
    if (table === 'generated_posts') {
      if (op === 'insert') return { data: { id: 'new-post-1' }, error: null }
      return { data: null, error: null }
    }
    if (table !== 'article_jobs') return { data: null, error: null }
    if (op === 'insert') return { data: { id: 'created-job-1' }, error: null }
    if (isClaim()) return { data: state.claimRows, error: null }
    if (isCasUpdate() && state.casUpdateRows !== undefined) return { data: state.casUpdateRows, error: null }
    if (op === 'select' && selectCols.includes('generated_post_id') && state.freshJob) return { data: state.freshJob, error: null }
    return { data: state.job, error: null }
  }
  chain.maybeSingle = vi.fn(async () => resolve())
  chain.single = vi.fn(async () => resolve())
  chain.then = (res: (v: unknown) => void) => res(resolve())
  return chain
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: vi.fn((t: string) => makeChain(t)) }) }))

import { advanceArticleJob, createManualArticleJob, LEASE_STALE_MS } from '@/lib/article-jobs/service'

const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1', source: 'manual', digest_id: null, status: 'pending', phase: 'planning', model: 'claude-opus-5', effort: 'high',
  selected_items: [{ id: 'i1', title: 't', content: 'c', source_display_name: 'S', source_url: null, source_identifier: 's' }],
  used_item_ids: ['i1'], attempts: 0, max_attempts: 3, started_at: null, generated_post_id: null,
  cursor: 0, plan: null, written_sections: [], vocabulary_intensity: 0, repo_intensity: 0, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  state.updates = []; state.ops = []; state.postOps = []; state.postInserts = []; state.jobInserts = []
  state.claimRows = [{ id: 'job-1' }]
  state.casUpdateRows = undefined
  state.freshJob = null
  state.job = job()
  mocks.planArticle.mockResolvedValue({
    thesis: 't', ordering: [1], headings: { '1': 'H' }, takeAngles: {}, retrievalHints: {},
    articleTitle: 'Titel', excerptBullets: ['a', 'b', 'c'], category: 'AI & Tech', introParagraph: 'Intro',
  })
  mocks.buildSectionContext.mockResolvedValue({
    cacheableUserPrefix: '', companiesPerItem: new Map(), metadataBlock: '---\nTITLE: T\n---\n\nIntro\n\n', loadedPatterns: [],
  })
  mocks.finalizeArticle.mockResolvedValue('---\nTITLE: Testartikel\nEXCERPT:\n• eins\nCATEGORY: AI & Tech\n---\n\nIntro\n\n## Abschnitt\n\nText.')
  mocks.selectAndEnrichItems.mockResolvedValue({
    pipelineItems: [{ id: 'i1', title: 't', content: 'c', source_display_name: null, source_url: null, source_identifier: 's' }],
    usedItemIds: ['i1'],
    sourceDistribution: [],
  })
})

describe('advanceArticleJob — Claim und Lease', () => {
  it('claimt per Compare-and-Set: Lease nur, wenn keiner laeuft (last_advanced_at null oder stale)', async () => {
    await advanceArticleJob('job-1')
    const claim = state.updates.find((u) => u.status === 'processing' && typeof u.last_advanced_at === 'string')
    expect(claim).toBeDefined()
    expect(state.ops).toContainEqual(['in', ['status', ['pending', 'processing']]])
    const orCall = state.ops.find(([name, args]) => name === 'or' && String(args[0]).includes('last_advanced_at.is.null'))
    expect(orCall).toBeDefined()
  })

  it('Claim verloren → claimed_elsewhere, keine Phase, keine Modellkosten', async () => {
    state.claimRows = []
    expect(await advanceArticleJob('job-1')).toBe('claimed_elsewhere')
    expect(mocks.planArticle).not.toHaveBeenCalled()
  })

  it('gibt den Lease am Ende der Phase frei, damit der naechste Tick sofort weitermacht', async () => {
    expect(await advanceArticleJob('job-1')).toBe('planned')
    const done = state.updates.find((u) => u.phase === 'writing')
    expect(done).toBeDefined()
    expect(done!.last_advanced_at).toBeNull()
  })

  it('bei einem Phasenfehler bleibt der Lease stehen (Stale-Fenster als Wiederholungsabstand)', async () => {
    mocks.planArticle.mockRejectedValueOnce(new Error('Modell weg'))
    expect(await advanceArticleJob('job-1')).toBe('tick_error')
    expect(state.updates.some((u) => u.last_advanced_at === null)).toBe(false)
  })

  it('LEASE_STALE_MS liegt ueber Vercels 800s-Funktionslimit (15 min = 900s)', () => {
    expect(LEASE_STALE_MS).toBe(15 * 60 * 1000)
    expect(LEASE_STALE_MS).toBeGreaterThan(800_000)
  })

  it('planning → writing leert written_sections, prüft phase+last_advanced_at per CAS und bricht bei 0 Treffern mit lease_lost ab', async () => {
    state.casUpdateRows = []
    expect(await advanceArticleJob('job-1')).toBe('lease_lost')
    const writeTransition = state.updates.find((u) => u.phase === 'writing')
    expect(writeTransition?.written_sections).toEqual([])
    expect(state.ops).toContainEqual(['eq', ['phase', 'planning']])
    expect(state.ops.some(([m, a]) => m === 'eq' && a[0] === 'last_advanced_at' && typeof a[1] === 'string')).toBe(true)
  })

  it('finalizing ohne digest_id prüft niemals eq("digest_id", null) und verwendet ein bereits erzeugtes generated_post_id wieder', async () => {
    state.job = job({
      phase: 'finalizing',
      digest_id: null,
      plan: {
        thesis: 't', ordering: [1], headings: { '1': 'H' }, takeAngles: {}, retrievalHints: {},
        articleTitle: 'T', excerptBullets: ['a', 'b', 'c'], category: 'AI & Tech', introParagraph: 'Intro',
      },
      written_sections: ['## H\n\nText.\n\n'],
      cursor: 1,
    })

    // 1) Keine existierende postId → legt genau 1 Post an, fragt NICHT eq('digest_id', null)
    expect(await advanceArticleJob('job-1')).toBe('finalized')
    expect(state.postInserts).toHaveLength(1)
    expect(state.postOps.some(([m, a]) => m === 'eq' && a[0] === 'digest_id')).toBe(false)

    // 2) Parallel hat bereits ein Driver generated_post_id gesetzt → kein zweites Insert
    state.updates = []
    state.postInserts = []
    state.freshJob = { phase: 'finalizing', last_advanced_at: undefined, generated_post_id: 'existing-post-99' }
    expect(await advanceArticleJob('job-1')).toBe('finalized')
    expect(state.postInserts).toHaveLength(0)
    const lexUpdate = state.updates.find((u) => u.phase === 'lexicon')
    expect(lexUpdate?.generated_post_id).toBe('existing-post-99')
  })

  it('finalizing akzeptiert Postgres-+00:00-Timestamps für denselben Zeitpunkt und erkennt fremde Leases weiterhin', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-11-24T12:42:57.710Z'))
      state.job = job({
        phase: 'finalizing',
        digest_id: null,
        plan: {
          thesis: 't', ordering: [1], headings: { '1': 'H' }, takeAngles: {}, retrievalHints: {},
          articleTitle: 'T', excerptBullets: ['a', 'b', 'c'], category: 'AI & Tech', introParagraph: 'Intro',
        },
        written_sections: ['## H\n\nText.\n\n'],
        cursor: 1,
      })

      // 1) Gleicher Zeitpunkt in Postgres-+00:00-Format mit gekürzter Null → gültiger Lease
      state.freshJob = {
        phase: 'finalizing',
        last_advanced_at: '2026-11-24T12:42:57.71+00:00',
        generated_post_id: null,
      }
      expect(await advanceArticleJob('job-1')).toBe('finalized')
      expect(state.postInserts).toHaveLength(1)

      // 2) Abweichender Zeitpunkt → weiterhin lease_lost und kein Insert
      state.updates = []
      state.postInserts = []
      state.freshJob = {
        phase: 'finalizing',
        last_advanced_at: '2026-11-24T12:43:10.000+00:00',
        generated_post_id: null,
      }
      expect(await advanceArticleJob('job-1')).toBe('lease_lost')
      expect(state.postInserts).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('createManualArticleJob deaktiviert fillFromBalanced standardmaessig (nur manuell gewaehlte Items)', async () => {
    await createManualArticleJob({
      maxItems: 26,
      model: 'claude-opus-5',
      effort: 'high',
      vocabularyIntensity: 50,
      repoIntensity: 40,
    })
    expect(mocks.selectAndEnrichItems).toHaveBeenCalledWith(
      expect.objectContaining({ fillFromBalanced: false, useSelected: true, maxItems: 26 }),
    )
  })
})
