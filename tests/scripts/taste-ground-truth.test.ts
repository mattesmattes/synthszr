import { describe, it, expect } from 'vitest'
import { extractQueueItemIds, dayWindow } from '@/scripts/lib/taste-ground-truth'

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
