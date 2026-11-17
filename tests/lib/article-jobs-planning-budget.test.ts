/**
 * Nacht-Artikel 2026-11-17 fehlte. BEFUND: Der Planer (Sonnet 5, thinking,
 * max_tokens 32000) brauchte an guten Tagen 27.900–31.100 Token; am 17.11.
 * endeten alle 22 Versuche zweier Auto-Jobs bei genau 32000 mit abgeschnittenem
 * JSON. Zusätzlich legte der Scheduler nach jedem Fehlschlag einen neuen Job an
 * (je zwölf Versuche à 0,54 USD). Jetzt: 64000 Token für den Plan und höchstens
 * drei fehlgeschlagene Auto-Jobs je Digest.
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  existingPost: null as { id: string } | null,
  openJob: null as { id: string } | null,
  failedJobs: 0,
  inserts: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/claude/ghostwriter-pipeline', () => ({
  planArticle: vi.fn(), writeSectionsBatch: vi.fn(), buildSectionContext: vi.fn(), finalizeArticle: vi.fn(),
}))
vi.mock('@/lib/claude/queue-article', () => ({
  selectAndEnrichItems: vi.fn(async () => ({ pipelineItems: [{ id: 'i1', title: 't', content: 'c' }], usedItemIds: ['i1'] })),
  toPipelineItem: vi.fn(),
  buildVocabularyContext: vi.fn(async () => ({ vocabulary: [], vocabularyContext: '' })),
}))
vi.mock('@/lib/ai/model-config', () => ({ getModelForUseCase: vi.fn(async () => 'claude-sonnet-5') }))
vi.mock('@/lib/images/cover-image', () => ({ generateCoverImagesForPost: vi.fn() }))
vi.mock('@/lib/stock-synthszr/warm', () => ({ ensureStockSynthszr: vi.fn() }))

function makeChain(table: string) {
  const filters: Array<[string, unknown]> = []
  let countQuery = false
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn((_cols: string, opts?: { count?: string; head?: boolean }) => { countQuery = !!opts?.head; return chain })
  for (const m of ['eq', 'neq', 'in', 'order', 'limit']) chain[m] = vi.fn((...args: unknown[]) => { filters.push([m, args]); return chain })
  chain.insert = vi.fn(async (row: Record<string, unknown>) => { state.inserts.push(row); return { error: null } })
  chain.maybeSingle = vi.fn(async () => {
    if (table === 'generated_posts') return { data: state.existingPost, error: null }
    if (table === 'article_jobs') return { data: state.openJob, error: null }
    return { data: null, error: null }
  })
  chain.then = (res: (v: unknown) => void) => res(countQuery ? { count: state.failedJobs, error: null } : { data: null, error: null })
  return chain
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: vi.fn((t: string) => makeChain(t)) }) }))

import { createArticleJob, MAX_FAILED_AUTO_JOBS } from '@/lib/article-jobs/service'

const opts = { digestId: 'd1', maxItems: 40, model: 'claude-opus-5-5', effort: 'high', vocabularyIntensity: 50, repoIntensity: 40 }

beforeEach(() => {
  state.existingPost = null
  state.openJob = null
  state.failedJobs = 0
  state.inserts = []
})

describe('createArticleJob: Kappe für fehlgeschlagene Auto-Jobs', () => {
  it('legt nach bis zu zwei Fehlschlägen einen neuen Job an', async () => {
    state.failedJobs = MAX_FAILED_AUTO_JOBS - 1
    expect(await createArticleJob(opts)).toEqual({ created: true })
    expect(state.inserts).toHaveLength(1)
  })

  it('hört nach drei fehlgeschlagenen Jobs für denselben Digest auf', async () => {
    state.failedJobs = MAX_FAILED_AUTO_JOBS
    expect(await createArticleJob(opts)).toEqual({ created: false, reason: 'too_many_failed_jobs' })
    expect(state.inserts).toHaveLength(0)
  })

  it('behält die bestehenden Sperren (Post vorhanden, Job läuft)', async () => {
    state.existingPost = { id: 'p1' }
    expect(await createArticleJob(opts)).toEqual({ created: false, reason: 'post_exists' })
    state.existingPost = null
    state.openJob = { id: 'j1' }
    expect(await createArticleJob(opts)).toEqual({ created: false, reason: 'job_exists' })
  })
})

describe('planArticle: Budget', () => {
  it('gibt dem Plan 64000 Token (Denken und JSON teilen sich das Budget)', () => {
    const src = readFileSync('lib/claude/ghostwriter-pipeline.ts', 'utf-8')
    expect(src).toMatch(/\{ thinking: true, maxTokens: 64000, useCase: 'article_planning' \}/)
    expect(src).not.toMatch(/maxTokens: 32000, useCase: 'article_planning'/)
  })
})
