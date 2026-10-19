/**
 * Hintergrund-Generierung (2026-10-19): der Server treibt den Artikel-Job, nicht
 * mehr der Browser. Dafür braucht advanceArticleJob (a) einen Compare-and-Set-
 * Claim — zwei Treiber (Minuten-Cron, 15-Minuten-Scheduler) dürfen denselben
 * Job nicht gleichzeitig vorantreiben — und (b) die Lease-Freigabe am Ende
 * jeder erfolgreichen Phase, damit der nächste Tick sofort weitermacht statt
 * sechs Minuten auf den Stale-Lease zu warten.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ planArticle: vi.fn() }))
vi.mock('@/lib/claude/ghostwriter-pipeline', () => ({
  planArticle: mocks.planArticle, writeSectionsBatch: vi.fn(), buildSectionContext: vi.fn(), finalizeArticle: vi.fn(),
}))
vi.mock('@/lib/claude/queue-article', () => ({
  selectAndEnrichItems: vi.fn(), toPipelineItem: vi.fn(),
  buildVocabularyContext: vi.fn(async () => ({ vocabulary: [], vocabularyContext: '' })),
}))
vi.mock('@/lib/ai/model-config', () => ({ getModelForUseCase: vi.fn(async () => 'claude-opus-5') }))
vi.mock('@/lib/images/cover-image', () => ({ generateCoverImagesForPost: vi.fn() }))
vi.mock('@/lib/stock-synthszr/warm', () => ({ ensureStockSynthszr: vi.fn() }))

const state = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  claimRows: [{ id: 'job-1' }] as Array<{ id: string }>,
  updates: [] as Array<Record<string, unknown>>,
  ops: [] as Array<[string, unknown[]]>,
}))

function makeChain(table: string) {
  let op = 'select'
  let payload: Record<string, unknown> | undefined
  const chain: Record<string, unknown> = {}
  const rec = (name: string) => vi.fn((...args: unknown[]) => { if (table === 'article_jobs') state.ops.push([name, args]); return chain })
  for (const m of ['select', 'eq', 'in', 'or', 'order', 'limit']) chain[m] = rec(m)
  chain.update = vi.fn((p: Record<string, unknown>) => { op = 'update'; payload = p; if (table === 'article_jobs') state.updates.push(p); return chain })
  const isClaim = () => op === 'update' && payload?.status === 'processing' && typeof payload?.last_advanced_at === 'string'
  const resolve = () => {
    if (table !== 'article_jobs') return { data: null, error: null }
    if (isClaim()) return { data: state.claimRows, error: null }
    return { data: state.job, error: null }
  }
  chain.maybeSingle = vi.fn(async () => resolve())
  chain.single = vi.fn(async () => resolve())
  chain.then = (res: (v: unknown) => void) => res(resolve())
  return chain
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: vi.fn((t: string) => makeChain(t)) }) }))

import { advanceArticleJob } from '@/lib/article-jobs/service'

const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1', source: 'manual', status: 'pending', phase: 'planning', model: 'claude-opus-5', effort: 'high',
  selected_items: [{ id: 'i1', title: 't', content: 'c' }], attempts: 0, max_attempts: 3, started_at: null,
  cursor: 0, plan: null, written_sections: [], vocabulary_intensity: 0, repo_intensity: 0, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  state.updates = []; state.ops = []; state.claimRows = [{ id: 'job-1' }]
  state.job = job()
  mocks.planArticle.mockResolvedValue({ thesis: 't', ordering: [1], headings: { '1': 'H' } })
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
})
