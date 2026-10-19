/**
 * Schritt „Assets“ in der lexicon-Phase (2026-10-19): Cover-Bild und Ratings-
 * Vorwärmung laufen jetzt im Job statt im Browser der Seite „AI Artikel
 * erstellen“ — sonst blieben sie aus, sobald der Tab (iOS) geschlossen ist.
 * Beides ist best-effort: der Job wird auch dann `done`, wenn Bild oder
 * Rating scheitern. Mock-Aufbau wie article-jobs-lexicon.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cover: vi.fn(), ensure: vi.fn(),
  getMatcherTerms: vi.fn(), extractLexTags: vi.fn(), findGlossaryMentions: vi.fn(), identifyCandidates: vi.fn(), buildCandidateList: vi.fn(),
}))
vi.mock('@/lib/claude/ghostwriter-pipeline', () => ({ planArticle: vi.fn(), writeSectionsBatch: vi.fn(), buildSectionContext: vi.fn(), finalizeArticle: vi.fn() }))
vi.mock('@/lib/claude/queue-article', () => ({ selectAndEnrichItems: vi.fn(), toPipelineItem: vi.fn(), buildVocabularyContext: vi.fn(async () => ({ vocabulary: [], vocabularyContext: '' })) }))
vi.mock('@/lib/ai/model-config', () => ({ getModelForUseCase: vi.fn(async () => 'claude-opus-5') }))
vi.mock('@/lib/glossary/terms', () => ({ getMatcherTerms: mocks.getMatcherTerms }))
vi.mock('@/lib/glossary/mentions', () => ({ extractLexTags: mocks.extractLexTags, findGlossaryMentions: mocks.findGlossaryMentions }))
vi.mock('@/lib/glossary/generate', () => ({ identifyCandidates: mocks.identifyCandidates }))
vi.mock('@/lib/glossary/candidates', () => ({ buildCandidateList: mocks.buildCandidateList }))
vi.mock('@/lib/images/cover-image', () => ({ generateCoverImagesForPost: mocks.cover }))
vi.mock('@/lib/stock-synthszr/warm', () => ({ ensureStockSynthszr: mocks.ensure }))

const state = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  postContent: null as unknown,
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}))

function makeChain(table: string) {
  let op = 'select'
  let payload: Record<string, unknown> | undefined
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'or', 'order', 'limit']) chain[m] = vi.fn(() => chain)
  chain.update = vi.fn((p: Record<string, unknown>) => { op = 'update'; payload = p; state.updates.push({ table, payload: p }); return chain })
  chain.insert = vi.fn((p: Record<string, unknown>) => { op = 'insert'; state.updates.push({ table, payload: p }); return chain })
  const resolve = () => {
    if (table === 'article_jobs') {
      if (op === 'update' && payload?.status === 'processing' && typeof payload?.last_advanced_at === 'string') return { data: [{ id: 'job-1' }], error: null }
      return { data: state.job, error: null }
    }
    if (table === 'generated_posts') return { data: { content: state.postContent }, error: null }
    return { data: null, error: null }
  }
  chain.maybeSingle = vi.fn(async () => resolve())
  chain.single = vi.fn(async () => resolve())
  chain.then = (res: (v: unknown) => void) => res(resolve())
  return chain
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: vi.fn((t: string) => makeChain(t)) }) }))

import { advanceArticleJob } from '@/lib/article-jobs/service'

const doc = (text: string) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

beforeEach(() => {
  vi.clearAllMocks()
  state.updates = []
  state.job = {
    id: 'job-1', source: 'manual', status: 'processing', phase: 'lexicon', model: 'claude-opus-5', effort: 'high',
    selected_items: [{ id: 'i1', title: 'Erster Titel', content: 'Inhalt des ersten Items, lang genug für ein Bild.' }, { id: 'i2', title: 'Zweiter', content: 'x' }],
    attempts: 0, max_attempts: 3, started_at: new Date().toISOString(), generated_post_id: 'post-1', cursor: 1, plan: null, written_sections: [],
    vocabulary_intensity: 0, repo_intensity: 0,
  }
  state.postContent = doc('Text mit {Nvidia} und {Microsoft}.')
  mocks.getMatcherTerms.mockResolvedValue([]); mocks.extractLexTags.mockReturnValue([]); mocks.findGlossaryMentions.mockReturnValue([])
  mocks.identifyCandidates.mockResolvedValue([]); mocks.buildCandidateList.mockResolvedValue([])
  mocks.cover.mockResolvedValue({ ok: true, image: null }); mocks.ensure.mockResolvedValue({ data: {}, cached: false })
})

describe('advanceArticleJob — Assets in der lexicon-Phase', () => {
  it('erzeugt das Cover aus dem ersten Item und waermt die Ratings aller {Company}-Tags vor, dann done', async () => {
    expect(await advanceArticleJob('job-1')).toBe('lexicon_done')
    expect(mocks.cover).toHaveBeenCalledTimes(1)
    expect(mocks.cover.mock.calls[0][0]).toMatchObject({ postId: 'post-1', newsText: 'Inhalt des ersten Items, lang genug für ein Bild.' })
    const companies = mocks.ensure.mock.calls.map((c) => c[0].company).sort()
    expect(companies.length).toBe(2)
    expect(new Set(companies).size).toBe(2)
    expect(state.updates.some((u) => u.table === 'article_jobs' && u.payload.status === 'done')).toBe(true)
  })

  it('Bild- und Rating-Fehler halten den Abschluss nicht auf', async () => {
    mocks.cover.mockRejectedValue(new Error('Gemini weg'))
    mocks.ensure.mockRejectedValue(new Error('Modell weg'))
    expect(await advanceArticleJob('job-1')).toBe('lexicon_done')
    expect(state.updates.some((u) => u.table === 'article_jobs' && u.payload.status === 'done')).toBe(true)
  })

  it('ohne Tags kein Rating-Aufruf; ohne brauchbaren Text kein Bild', async () => {
    state.postContent = doc('Keine Tags.')
    ;(state.job as any).selected_items = [{ id: 'i1', title: 'T', content: '' }]
    expect(await advanceArticleJob('job-1')).toBe('lexicon_done')
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.cover).not.toHaveBeenCalled()
  })
})
