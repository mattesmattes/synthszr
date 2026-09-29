import { describe, it, expect } from 'vitest'
import { extractQueueItemIds, dayWindow, loadDayCandidates, DAY_LIMIT } from '@/scripts/lib/taste-ground-truth'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

/** Fluent Supabase-Query-Mock fuer loadDayCandidates: from().select().gte().lt().order().limit(). */
function mockSupabase(result: { data: unknown[] | null; error: { message: string } | null }) {
  const calls: Record<string, unknown[]> = {}
  const builder = {
    select: (...a: unknown[]) => { calls.select = a; return builder },
    gte: (...a: unknown[]) => { calls.gte = a; return builder },
    lt: (...a: unknown[]) => { calls.lt = a; return builder },
    order: (...a: unknown[]) => { calls.order = a; return builder },
    limit: async (...a: unknown[]) => { calls.limit = a; return result },
  }
  const supabase = { from: () => builder } as unknown as AdminClient
  return { supabase, calls }
}

describe('extractQueueItemIds', () => {
  it('liest queueItemId aus Objekt-Content', () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { queueItemId: 'a1' }, content: [{ type: 'text', text: 'H1' }] },
      ],
    }
    expect(extractQueueItemIds(content)).toEqual(['a1'])
  })

  it('parst JSON-String-Content genauso wie Objekt-Content', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [{ type: 'heading', attrs: { queueItemId: 'b2' }, content: [] }],
    })
    expect(extractQueueItemIds(content)).toEqual(['b2'])
  })

  it('findet Headings in verschachtelten Knoten (Tiefe >= 2)', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'section',
          content: [
            {
              type: 'group',
              content: [
                { type: 'heading', attrs: { queueItemId: 'deep1' }, content: [] },
              ],
            },
          ],
        },
      ],
    }
    expect(extractQueueItemIds(content)).toEqual(['deep1'])
  })

  it('ignoriert queueItemId an Nicht-Heading-Knoten', () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { queueItemId: 'ignored' }, content: [] },
      ],
    }
    expect(extractQueueItemIds(content)).toEqual([])
  })

  it('dedupliziert wiederholte queueItemIds', () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { queueItemId: 'dup' }, content: [] },
        {
          type: 'section',
          content: [{ type: 'heading', attrs: { queueItemId: 'dup' }, content: [] }],
        },
      ],
    }
    expect(extractQueueItemIds(content)).toEqual(['dup'])
  })

  it('liefert [] bei ungueltigem JSON-String', () => {
    expect(extractQueueItemIds('{not valid json')).toEqual([])
  })

  it('liefert [] bei null/undefined/leerem Content', () => {
    expect(extractQueueItemIds(null)).toEqual([])
    expect(extractQueueItemIds(undefined)).toEqual([])
    expect(extractQueueItemIds({})).toEqual([])
  })
})

describe('dayWindow', () => {
  it('normaler Tag: from ist Tagesanfang UTC, to der naechste Tag um 00:00Z', () => {
    expect(dayWindow('2026-06-15')).toEqual({
      from: '2026-06-15T00:00:00.000Z',
      to: '2026-06-16T00:00:00.000Z',
    })
  })

  it('Monatsende: 2026-02-28 -> to ist 2026-03-01 (kein Schaltjahr)', () => {
    expect(dayWindow('2026-02-28')).toEqual({
      from: '2026-02-28T00:00:00.000Z',
      to: '2026-03-01T00:00:00.000Z',
    })
  })

  it('Jahresende: 2026-12-31 -> to ist 2027-01-01', () => {
    expect(dayWindow('2026-12-31')).toEqual({
      from: '2026-12-31T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
    })
  })
})

interface Row { id: string; title: string; content_length: number | null }

describe('loadDayCandidates', () => {
  const day = '2026-03-01'

  it('filtert Junk-Titel und zu kurze Items raus (wie Backfill/Ranking Stufe 1)', async () => {
    const rows: Row[] = [
      { id: '1', title: 'Ein echter Artikeltitel ueber KI', content_length: 900 },
      { id: '2', title: 'Wordle', content_length: 900 }, // Junk-Titel
      { id: '3', title: 'Ein echter Artikeltitel, aber zu kurz', content_length: 100 }, // < 500
    ]
    const { supabase } = mockSupabase({ data: rows, error: null })
    const res = await loadDayCandidates<Row>(supabase, day, 'id, title, content_length')
    expect(res.error).toBeNull()
    expect(res.rows.map((r) => r.id)).toEqual(['1'])
    expect(res.truncated).toBe(false)
  })

  it('nutzt dayWindow(day) fuer das Tagesfenster (gte/lt)', async () => {
    const { supabase, calls } = mockSupabase({ data: [], error: null })
    await loadDayCandidates<Row>(supabase, day, 'id, title, content_length')
    const { from, to } = dayWindow(day)
    expect(calls.gte).toEqual(['queued_at', from])
    expect(calls.lt).toEqual(['queued_at', to])
    expect(calls.order).toEqual(['id', { ascending: true }])
    expect(calls.limit).toEqual([DAY_LIMIT])
  })

  it('meldet truncated=true, wenn die Rohzeilenzahl genau DAY_LIMIT erreicht', async () => {
    const rows: Row[] = Array.from({ length: DAY_LIMIT }, (_, i) => ({
      id: String(i), title: 'Ein echter Artikeltitel ueber KI', content_length: 900,
    }))
    const { supabase } = mockSupabase({ data: rows, error: null })
    const res = await loadDayCandidates<Row>(supabase, day, 'id, title, content_length')
    expect(res.truncated).toBe(true)
  })

  it('wirft NICHT bei Query-Fehler, sondern gibt error als String zurueck', async () => {
    const { supabase } = mockSupabase({ data: null, error: { message: 'Boom' } })
    const res = await loadDayCandidates<Row>(supabase, day, 'id, title, content_length')
    expect(res.error).toBe('Boom')
    expect(res.rows).toEqual([])
    expect(res.truncated).toBe(false)
  })
})
