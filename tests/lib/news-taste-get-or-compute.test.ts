import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FEATURES_VERSION } from '@/lib/news-taste/questions'

const upserted: unknown[] = []
let existingRows: Array<{ queue_item_id: string; features: Record<string, number> }> = []
let upsertResult: { error: null } | { error: { message: string } } = { error: null }

const eqMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (...args: unknown[]) => {
          eqMock(...args)
          return {
            in: async () => ({ data: existingRows, error: null }),
          }
        },
      }),
      upsert: async (rows: unknown) => { upserted.push(rows); return upsertResult },
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

beforeEach(() => { upserted.length = 0; existingRows = []; evaluateMock.mockReset(); eqMock.mockReset(); upsertResult = { error: null } })

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
    // WARUM: Versionsfilter darf nur aktuelle FEATURES_VERSION laden
    expect(eqMock).toHaveBeenCalledWith('features_version', FEATURES_VERSION)
  })

  it('sammelt fehlgeschlagene Items in failedIds statt zu werfen', async () => {
    evaluateMock.mockRejectedValue(new Error('Gateway 503'))
    const res = await getOrComputeFeatures([input('a')])
    expect(res.features.size).toBe(0)
    expect(res.failedIds).toEqual(['a'])
  })

  it('speichert Vektor auch wenn upsert mit error antwortet (Fehler geloggt, nicht geworfen)', async () => {
    evaluateMock.mockResolvedValue({
      answers: { concrete_event: { type: 'boolean', probability: 0.8 } },
      usage: { inputTokens: 100, outputTokens: 10 }, costUsd: 0.000004,
    })
    upsertResult = { error: { message: 'Database locked' } }
    const res = await getOrComputeFeatures([input('a')])
    // Vektor ist da (Speicherung in Memory erfolgt VOR upsert-Versuch)
    expect(res.features.get('a')?.concrete_event).toBe(0.8)
    // Fehler wirft nicht, failedIds bleibt leer
    expect(res.failedIds).toEqual([])
  })
})
