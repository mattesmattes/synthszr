import { describe, it, expect, vi, beforeEach } from 'vitest'

const upserted: unknown[] = []
let existingRows: Array<{ queue_item_id: string; features: Record<string, number> }> = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: existingRows, error: null }),
        }),
      }),
      upsert: async (rows: unknown) => { upserted.push(rows); return { error: null } },
    }),
  }),
}))

const evaluateMock = vi.fn()
vi.mock('@/lib/ai/evaluate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/evaluate')>()),
  evaluateState: (...args: unknown[]) => evaluateMock(...args),
}))

import { getOrComputeFeatures, type TasteInput } from '@/lib/news-taste/features'

const input = (id: string): TasteInput => ({
  queueItemId: id, title: `Titel ${id}`, source: 'S', text: 'Text',
  synthesis: 5, relevance: 5, uniqueness: 5, sourceBonus: 0, sourcePubRate: 0, contentLength: 1000,
})

beforeEach(() => { upserted.length = 0; existingRows = []; evaluateMock.mockReset() })

describe('getOrComputeFeatures', () => {
  it('nutzt gespeicherte Vektoren und berechnet nur fehlende (Review Focus 4: Lookup filtert Version)', async () => {
    existingRows = [{ queue_item_id: 'a', features: { concrete_event: 0.7 } }]
    evaluateMock.mockResolvedValue({
      answers: { concrete_event: { type: 'boolean', probability: 0.9 } },
      usage: { inputTokens: 100, outputTokens: 10 }, costUsd: 0.000004,
    })
    const res = await getOrComputeFeatures([input('a'), input('b')])
    expect(res.features.get('a')?.concrete_event).toBe(0.7) // aus DB, kein Call
    expect(res.features.get('b')?.concrete_event).toBe(0.9) // frisch berechnet
    expect(evaluateMock).toHaveBeenCalledTimes(1)
    expect(upserted.length).toBe(1) // nur b gespeichert
    expect(res.failedIds).toEqual([])
  })

  it('sammelt fehlgeschlagene Items in failedIds statt zu werfen', async () => {
    evaluateMock.mockRejectedValue(new Error('Gateway 503'))
    const res = await getOrComputeFeatures([input('a')])
    expect(res.features.size).toBe(0)
    expect(res.failedIds).toEqual(['a'])
  })
})
