/**
 * Job-Phase `lexicon` (Task 10): läuft hinter `finalizing`, weil erst dort
 * über persistDraftPost die generated_post_id entsteht, an der die
 * Kandidatenliste hängt.
 *
 * Mock-Strategie: die schweren AI-Pipeline-Module (ghostwriter-pipeline,
 * queue-article) sind gemockt — kein echter LLM-Call. Die Glossar-Module
 * (terms/mentions/generate/candidates) sind ebenfalls gemockt: ihr eigenes
 * Verhalten ist bereits in glossary-terms.test.ts, glossary-mentions.test.ts,
 * glossary-generate.test.ts und glossary-candidates.test.ts abgedeckt — hier
 * geht es NUR um die Verdrahtung in advanceArticleJob: läuft `lexicon` nach
 * `finalizing` statt direkt `status=done`, schreibt die Phase die
 * Kandidatenliste + schließt den Job ab, und übersteht der Job einen Fehler
 * in der Begriffssuche.
 *
 * persistDraftPost (aufgerufen aus `finalizing`) läuft dagegen ECHT
 * (parseArticleContent, sanitizeTiptapUrls, buildUniqueSlug, die jsdom+
 * prosemirror-Markdown-Konvertierung) — Muster aus
 * tests/lib/markdown-to-tiptap-bundle.test.ts: diese Bausteine sind pure/
 * dependency-frei bzw. laufen nachweislich unter vitest's node-environment,
 * ein Mock würde nur Mock-Verhalten prüfen statt echter Verdrahtung.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildSectionContext: vi.fn(),
  finalizeArticle: vi.fn(),
  getMatcherTerms: vi.fn(),
  extractLexTags: vi.fn(),
  findGlossaryMentions: vi.fn(),
  identifyCandidates: vi.fn(),
  buildCandidateList: vi.fn(),
}))

vi.mock('@/lib/claude/ghostwriter-pipeline', () => ({
  planArticle: vi.fn(),
  writeSectionsBatch: vi.fn(),
  buildSectionContext: mocks.buildSectionContext,
  finalizeArticle: mocks.finalizeArticle,
}))
vi.mock('@/lib/claude/queue-article', () => ({
  selectAndEnrichItems: vi.fn(),
  toPipelineItem: vi.fn(),
  buildVocabularyContext: vi.fn(async () => ({ vocabulary: [], vocabularyContext: '' })),
}))
vi.mock('@/lib/ai/model-config', () => ({ getModelForUseCase: vi.fn(async () => 'claude-opus-5') }))
vi.mock('@/lib/glossary/terms', () => ({ getMatcherTerms: mocks.getMatcherTerms }))
vi.mock('@/lib/glossary/mentions', () => ({
  extractLexTags: mocks.extractLexTags,
  findGlossaryMentions: mocks.findGlossaryMentions,
}))
vi.mock('@/lib/glossary/generate', () => ({ identifyCandidates: mocks.identifyCandidates }))
vi.mock('@/lib/glossary/candidates', () => ({ buildCandidateList: mocks.buildCandidateList }))

const state = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  postContent: null as unknown,
  insertedPostId: 'new-post-1',
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}))

function resolveQuery(table: string, op: string, cols: string | undefined) {
  if (table === 'article_jobs') return { data: state.job, error: null }
  if (table === 'generated_posts') {
    if (op === 'insert') return { data: { id: state.insertedPostId }, error: null }
    if (cols === 'content') return { data: { content: state.postContent }, error: null }
    return { data: null, error: null } // existing-draft-check / slug-uniqueness-check: nichts gefunden
  }
  return { data: null, error: null }
}

function makeChain(table: string) {
  let op = 'select'
  let cols: string | undefined
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn((c?: string) => { cols = c; return chain })
  chain.eq = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.update = vi.fn((payload: Record<string, unknown>) => {
    op = 'update'
    state.updates.push({ table, payload })
    return chain
  })
  chain.insert = vi.fn((payload: Record<string, unknown>) => {
    op = 'insert'
    state.updates.push({ table, payload })
    return chain
  })
  chain.upsert = vi.fn((payload: Record<string, unknown>) => {
    state.updates.push({ table, payload })
    return { error: null }
  })
  const resolve = () => resolveQuery(table, op, cols)
  chain.maybeSingle = vi.fn(async () => resolve())
  chain.single = vi.fn(async () => resolve())
  chain.then = (res: (v: unknown) => void) => res(resolve())
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: vi.fn((table: string) => makeChain(table)) }),
}))

const FIXTURE_MARKDOWN = `---
TITLE: Testartikel für Task 10
EXCERPT:
• eins
• zwei
• drei
CATEGORY: AI & Tech
---

Ein einleitender Absatz ohne Fachjargon.

## Erste Überschrift

Etwas Text mit Inhalt.
`

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    digest_id: 'digest-1',
    source: 'auto',
    status: 'processing',
    phase: 'finalizing',
    model: 'claude-opus-5',
    effort: 'medium',
    max_items: 5,
    vocabulary_intensity: 0,
    repo_intensity: 0,
    selected_items: [{ id: 'i1', title: 't', content: 'c', source_display_name: 's', source_url: null, source_identifier: 'src-1' }],
    used_item_ids: [],
    plan: {
      thesis: 'These', ordering: [1], headings: { '1': 'Heading' }, takeAngles: {}, retrievalHints: {},
      articleTitle: 'Titel', excerptBullets: ['a', 'b', 'c'], category: 'AI & Tech', introParagraph: 'Intro',
    },
    written_sections: ['Section-Text.'],
    cursor: 1,
    attempts: 0,
    max_attempts: 3,
    started_at: new Date().toISOString(),
    generated_post_id: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.job = null
  state.postContent = null
  state.insertedPostId = 'new-post-1'
  state.updates = []
  mocks.buildSectionContext.mockResolvedValue({ metadataBlock: 'META\n', companiesPerItem: new Map(), loadedPatterns: [] })
  mocks.finalizeArticle.mockResolvedValue(FIXTURE_MARKDOWN)
  mocks.getMatcherTerms.mockResolvedValue([])
  mocks.extractLexTags.mockReturnValue([])
  mocks.findGlossaryMentions.mockReturnValue([])
  mocks.identifyCandidates.mockResolvedValue([])
  mocks.buildCandidateList.mockResolvedValue([])
})

describe('advanceArticleJob — Übergang finalizing → lexicon', () => {
  it('setzt nach finalizing phase=lexicon statt status=done', async () => {
    state.job = makeJob({ phase: 'finalizing' })
    const { advanceArticleJob } = await import('@/lib/article-jobs/service')
    const result = await advanceArticleJob('job-1')

    expect(result).toBe('finalized')
    const phaseUpdate = state.updates.find((u) => u.table === 'article_jobs' && 'phase' in u.payload)
    expect(phaseUpdate?.payload).toEqual({ phase: 'lexicon', generated_post_id: state.insertedPostId })
    // Kein status:'done' in diesem Schritt — die lexicon-Phase schließt den Job ab.
    expect(state.updates.some((u) => u.table === 'article_jobs' && u.payload.status === 'done')).toBe(false)
  })
})

describe('advanceArticleJob — Phase lexicon', () => {
  it('schließt den Job in der lexicon-Phase ab und schreibt die Kandidatenliste', async () => {
    state.job = makeJob({ phase: 'lexicon', generated_post_id: 'post-1' })
    state.postContent = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text über Inferenz.' }] }],
    })
    mocks.getMatcherTerms.mockResolvedValue([{ slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] }])
    mocks.extractLexTags.mockReturnValue(['Inferenz'])
    mocks.buildCandidateList.mockResolvedValue([{ slug: 'inferenz', name: 'Inferenz', origin: 'tag', matchedText: null }])

    const { advanceArticleJob } = await import('@/lib/article-jobs/service')
    const result = await advanceArticleJob('job-1')

    expect(result).toBe('lexicon_done')
    expect(mocks.buildCandidateList).toHaveBeenCalledWith(
      expect.anything(),
      [{ slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] }],
      ['Inferenz'],
      [],
      [],
    )
    const candidatesUpdate = state.updates.find((u) => u.table === 'generated_posts' && 'pending_glossary_terms' in u.payload)
    expect(candidatesUpdate?.payload.pending_glossary_terms).toEqual([
      { slug: 'inferenz', name: 'Inferenz', origin: 'tag', matchedText: null },
    ])
    const jobDone = state.updates.find((u) => u.table === 'article_jobs' && u.payload.status === 'done')
    expect(jobDone?.payload).toMatchObject({ status: 'done', phase: null })
  })

  it('schließt den Job auch ab, wenn die Kandidatensuche fehlschlägt', async () => {
    state.job = makeJob({ phase: 'lexicon', generated_post_id: 'post-1' })
    state.postContent = JSON.stringify({ type: 'doc', content: [] })
    mocks.getMatcherTerms.mockRejectedValue(new Error('DB nicht erreichbar'))

    const { advanceArticleJob } = await import('@/lib/article-jobs/service')
    const result = await advanceArticleJob('job-1')

    // Diskriminierend: ohne das try/catch um die Begriffssuche würde der Wurf
    // bis in den äußeren catch von advanceArticleJob durchschlagen — der gäbe
    // 'tick_error' zurück und der Job bliebe 'processing' (kein status=done-
    // Update), statt den (bereits fertigen) Artikel abzuschließen.
    expect(result).toBe('lexicon_done')
    const jobDone = state.updates.find((u) => u.table === 'article_jobs' && u.payload.status === 'done')
    expect(jobDone?.payload).toMatchObject({ status: 'done', phase: null })
    // Die Kandidatenliste wurde nicht geschrieben — die Suche scheiterte davor.
    expect(state.updates.some((u) => u.table === 'generated_posts' && 'pending_glossary_terms' in u.payload)).toBe(false)
  })
})
