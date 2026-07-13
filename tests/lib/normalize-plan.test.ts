import { describe, it, expect } from 'vitest'
import { normalizeArticlePlan } from '@/lib/claude/normalize-plan'

describe('normalizeArticlePlan', () => {
  it('leaves a well-formed plan unchanged (idempotent)', () => {
    const plan = {
      thesis: 't',
      ordering: [2, 1],
      headings: { '1': 'A', '2': 'B' },
      articleTitle: 'x',
      excerptBullets: ['a', 'b', 'c'],
      category: 'AI',
      introParagraph: 'i',
    }
    const out = normalizeArticlePlan(plan as any, 2)
    expect(out.ordering).toEqual([2, 1])
    expect(out.headings).toEqual({ '1': 'A', '2': 'B' })
  })

  it('normalizes object-shaped ordering with inline headings and missing top-level headings', () => {
    // This is the exact malformed shape Gemini emitted on 2026-07-07:
    // ordering is an array of {id, headings:string} objects, no top-level headings.
    const plan = {
      thesis: 't',
      ordering: [
        { id: 2, category: 'AI', headings: 'Zweite Überschrift' },
        { id: 1, category: 'AI', headings: 'Erste Überschrift' },
      ],
      // headings intentionally undefined
      articleTitle: 'x',
      excerptBullets: ['a', 'b', 'c'],
      category: 'AI',
      introParagraph: 'i',
    }
    const out = normalizeArticlePlan(plan as any, 2)
    expect(out.ordering).toEqual([2, 1])
    expect(out.headings).toEqual({ '1': 'Erste Überschrift', '2': 'Zweite Überschrift' })
  })

  it('drops the validation-appended numeric duplicates that follow object entries', () => {
    // planArticle's old validation loop appended 1..N as numbers because the
    // Set contained objects → ordering = [obj, obj, 1, 2]. Dedup must keep the
    // curated object order and drop the numeric tail.
    const plan = {
      thesis: 't',
      ordering: [
        { id: 2, headings: 'B' },
        { id: 1, headings: 'A' },
        1,
        2,
      ],
      articleTitle: 'x',
      excerptBullets: ['a', 'b', 'c'],
      category: 'AI',
      introParagraph: 'i',
    }
    const out = normalizeArticlePlan(plan as any, 2)
    expect(out.ordering).toEqual([2, 1])
  })

  it('appends missing item indices (every item must appear exactly once)', () => {
    const plan = {
      thesis: 't',
      ordering: [{ id: 2, headings: 'B' }],
      articleTitle: 'x',
      excerptBullets: ['a', 'b', 'c'],
      category: 'AI',
      introParagraph: 'i',
    }
    const out = normalizeArticlePlan(plan as any, 3)
    // 2 from the object, then 1 and 3 appended in order
    expect(out.ordering).toEqual([2, 1, 3])
    expect(out.headings['2']).toBe('B')
  })

  it('discards out-of-range and non-numeric ids without crashing', () => {
    const plan = {
      thesis: 't',
      ordering: [{ id: 99, headings: 'X' }, { id: 'bogus', headings: 'Y' }, 1],
      headings: undefined,
      articleTitle: 'x',
      excerptBullets: ['a', 'b', 'c'],
      category: 'AI',
      introParagraph: 'i',
    }
    const out = normalizeArticlePlan(plan as any, 2)
    expect(out.ordering).toEqual([1, 2])
    // 99 and 'bogus' contributed no valid heading key
    expect(out.headings['99']).toBeUndefined()
  })

  it('guarantees headings is always a plain object (never undefined)', () => {
    const plan = {
      thesis: 't',
      ordering: [1],
      headings: undefined,
      articleTitle: 'x',
      excerptBullets: ['a', 'b', 'c'],
      category: 'AI',
      introParagraph: 'i',
    }
    const out = normalizeArticlePlan(plan as any, 1)
    expect(out.headings).toBeTypeOf('object')
    expect(out.headings).not.toBeNull()
  })

  it('übernimmt ein wohlgeformtes takeAngles-Objekt', () => {
    const plan = {
      ordering: [1, 2],
      headings: { '1': 'A', '2': 'B' },
      takeAngles: { '1': 'Zweitrundeneffekt', '2': 'Historische Parallele' },
    }
    const out = normalizeArticlePlan(plan as any, 2)
    expect(out.takeAngles).toEqual({ '1': 'Zweitrundeneffekt', '2': 'Historische Parallele' })
  })

  it('liefert leeres takeAngles, wenn das Feld fehlt', () => {
    const plan = { ordering: [1, 2], headings: { '1': 'A', '2': 'B' } }
    const out = normalizeArticlePlan(plan as any, 2)
    expect(out.takeAngles).toEqual({})
  })

  it('liefert leeres takeAngles, wenn das Feld gedriftet (Array) ist', () => {
    const plan = { ordering: [1], headings: { '1': 'A' }, takeAngles: ['x'] }
    const out = normalizeArticlePlan(plan as any, 1)
    expect(out.takeAngles).toEqual({})
  })
})
