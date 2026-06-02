import { describe, it, expect } from 'vitest'
import { parseRerankerResponse } from '@/lib/news-queue/reranker-parse'

const valid = new Set(['a', 'b', 'c'])

describe('parseRerankerResponse', () => {
  it('parses a clean JSON array sorted by rank', () => {
    const text = '[{"queueItemId":"b","rank":2,"reason":"r2","confidence":0.6},{"queueItemId":"a","rank":1,"reason":"r1","confidence":0.9}]'
    const out = parseRerankerResponse(text, valid)
    expect(out.map((o) => o.queueItemId)).toEqual(['a', 'b'])
  })
  it('drops hallucinated ids not in the candidate set', () => {
    const text = '[{"queueItemId":"zzz","rank":1,"reason":"x","confidence":0.5},{"queueItemId":"a","rank":2,"reason":"y","confidence":0.5}]'
    const out = parseRerankerResponse(text, valid)
    expect(out.map((o) => o.queueItemId)).toEqual(['a'])
  })
  it('tolerates surrounding prose / markdown fences', () => {
    const text = 'Hier:\n```json\n[{"queueItemId":"c","rank":1,"reason":"r","confidence":0.7}]\n```'
    expect(parseRerankerResponse(text, valid).map((o) => o.queueItemId)).toEqual(['c'])
  })
  it('returns [] on malformed input', () => {
    expect(parseRerankerResponse('not json at all', valid)).toEqual([])
  })
  it('dedupes repeated ids, keeping the first', () => {
    const text = '[{"queueItemId":"a","rank":1,"reason":"r","confidence":0.5},{"queueItemId":"a","rank":2,"reason":"r","confidence":0.5}]'
    expect(parseRerankerResponse(text, valid).length).toBe(1)
  })
})
