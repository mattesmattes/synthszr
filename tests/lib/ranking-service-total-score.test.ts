/**
 * Task 10': generateRankingSuggestions() rankt jetzt nach total_score + Dedup
 * statt LLM-Reranker (Gate-Befund: total_score schlägt Reranker und jedes
 * trainierte Modell, siehe Kopfkommentar in ranking-service.ts).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

interface Row {
  id: string
  title: string
  excerpt: string | null
  source_display_name: string | null
  total_score: number
  email_received_at: string | null
  queued_at: string | null
  content_length: number
}

const state = vi.hoisted(() => ({
  rows: [] as Row[],
}))

const mocks = vi.hoisted(() => ({
  dedupeByTopicMock: vi.fn(),
  createRunMock: vi.fn(async () => 'run-1'),
  recordSuggestionsMock: vi.fn(async () => {}),
}))
const { dedupeByTopicMock, createRunMock, recordSuggestionsMock } = mocks

function makeChain() {
  const chain: any = {}
  for (const m of ['select', 'eq', 'gt', 'gte', 'order', 'limit']) chain[m] = vi.fn(() => chain)
  chain.then = (res: (v: unknown) => void) => res({ data: state.rows, error: null })
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: vi.fn(() => makeChain()) }),
}))

vi.mock('@/lib/news-queue/service', () => ({
  isJunkTitle: vi.fn(() => false),
}))

vi.mock('@/lib/news-queue/semantic-dedup', () => ({
  dedupeByTopic: mocks.dedupeByTopicMock,
}))

vi.mock('@/lib/news-queue/suggestions', () => ({
  createRun: mocks.createRunMock,
  recordSuggestions: mocks.recordSuggestionsMock,
}))

import { generateRankingSuggestions } from '@/lib/news-queue/ranking-service'

function row(id: string, totalScore: number, overrides: Partial<Row> = {}): Row {
  return {
    id,
    title: `Titel ${id}`,
    excerpt: `Excerpt ${id}`,
    source_display_name: 'reuters.com',
    total_score: totalScore,
    email_received_at: '2026-09-28T08:00:00Z',
    queued_at: '2026-09-28T07:00:00Z',
    content_length: 1000,
    ...overrides,
  }
}

/** Default dedup mock: passes everything through unchanged, sorted desc by total_score. */
function passThroughDedup(items: Array<{ total_score?: number }>) {
  return { kept: [...items].sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0)), dropped: [] }
}

beforeEach(() => {
  state.rows = []
  dedupeByTopicMock.mockReset()
  createRunMock.mockClear()
  recordSuggestionsMock.mockClear()
  dedupeByTopicMock.mockImplementation(async (items: any[]) => passThroughDedup(items))
})

describe('generateRankingSuggestions (total_score + dedup)', () => {
  it('a) sortiert Vorschläge nach total_score, rank ab 1, reason enthält den Score, confidence des ersten = 1', async () => {
    state.rows = [row('a', 9.2), row('b', 5.5), row('c', 3.1)]
    const result = await generateRankingSuggestions()
    expect(result.suggestions.map((s) => s.queueItemId)).toEqual(['a', 'b', 'c'])
    expect(result.suggestions[0].rank).toBe(1)
    expect(result.suggestions[1].rank).toBe(2)
    expect(result.suggestions[0].reason).toBe('total_score 9.2')
    expect(result.suggestions[0].confidence).toBe(1)
  })

  it('b) ein von dedupeByTopic verworfenes Item fehlt, das nächste rückt nach', async () => {
    state.rows = [row('a', 9.0), row('b', 8.0), row('c', 5.0)]
    dedupeByTopicMock.mockImplementation(async (items: any[]) => {
      const sorted = [...items].sort((x, y) => (y.total_score ?? 0) - (x.total_score ?? 0))
      return { kept: sorted.filter((i) => i.id !== 'b'), dropped: [{ id: 'b', title: 'Titel b', similarTo: 'a', similarity: 0.9, reason: 'batch' as const }] }
    })
    const result = await generateRankingSuggestions()
    expect(result.suggestions.map((s) => s.queueItemId)).toEqual(['a', 'c'])
    expect(result.suggestions[1].rank).toBe(2)
  })

  it('c) höchstens 15 Vorschläge bei 40 Kandidaten', async () => {
    state.rows = Array.from({ length: 40 }, (_, i) => row(`id${i}`, 40 - i))
    const result = await generateRankingSuggestions()
    expect(result.suggestions.length).toBe(15)
    expect(dedupeByTopicMock).toHaveBeenCalledTimes(1)
    const [items, opts] = dedupeByTopicMock.mock.calls[0]
    expect(items.length).toBe(40)
    expect(opts).toEqual({ recentCoverageDays: 7 })
  })

  it('d) createRun mit model total_score und stage1Method recency+junk+total_score+dedup', async () => {
    state.rows = [row('a', 9.0)]
    await generateRankingSuggestions()
    expect(createRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ stage1Method: 'recency+junk+total_score+dedup', model: 'total_score' })
    )
  })

  it('e) leerer Pool -> runId "", createRun nicht aufgerufen', async () => {
    state.rows = []
    const result = await generateRankingSuggestions()
    expect(result).toEqual({ runId: '', suggestions: [] })
    expect(createRunMock).not.toHaveBeenCalled()
    expect(dedupeByTopicMock).not.toHaveBeenCalled()
  })

  it('f) Items mit content_length < 500 fehlen', async () => {
    state.rows = [row('a', 9.0, { content_length: 499 }), row('b', 8.0, { content_length: 500 })]
    const result = await generateRankingSuggestions()
    expect(result.suggestions.map((s) => s.queueItemId)).toEqual(['b'])
  })
})
