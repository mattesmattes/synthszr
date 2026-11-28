import { describe, expect, it } from 'vitest'
import { applyMultiSelect } from '@/lib/news-queue/multi-select'

describe('applyMultiSelect', () => {
  const visibleIds = ['a', 'b', 'c', 'd', 'e']

  it('toggles single items and updates anchor when shiftKey is false', () => {
    const step1 = applyMultiSelect({
      visibleIds,
      selected: new Set(),
      anchorId: null,
      clickedId: 'b',
      shiftKey: false,
    })
    expect([...step1.selected]).toEqual(['b'])
    expect(step1.anchorId).toBe('b')

    const step2 = applyMultiSelect({
      visibleIds,
      selected: step1.selected,
      anchorId: step1.anchorId,
      clickedId: 'd',
      shiftKey: false,
    })
    expect([...step2.selected]).toEqual(['b', 'd'])
    expect(step2.anchorId).toBe('d')

    const step3 = applyMultiSelect({
      visibleIds,
      selected: step2.selected,
      anchorId: step2.anchorId,
      clickedId: 'b',
      shiftKey: false,
    })
    expect([...step3.selected]).toEqual(['d'])
    expect(step3.anchorId).toBe('b')
  })

  it('selects forward and backward ranges cleanly on Shift+Click while keeping existing selection and anchor', () => {
    const forward = applyMultiSelect({
      visibleIds,
      selected: new Set(['b']),
      anchorId: 'b',
      clickedId: 'e',
      shiftKey: true,
    })
    expect([...forward.selected].sort()).toEqual(['b', 'c', 'd', 'e'])
    expect(forward.anchorId).toBe('b')

    const backward = applyMultiSelect({
      visibleIds,
      selected: new Set(['d']),
      anchorId: 'd',
      clickedId: 'a',
      shiftKey: true,
    })
    expect([...backward.selected].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(backward.anchorId).toBe('d')
  })

  it('falls back to single toggle & sets anchor when Shift+Click has no valid anchor', () => {
    const res = applyMultiSelect({
      visibleIds,
      selected: new Set(['a']),
      anchorId: 'missing-id',
      clickedId: 'c',
      shiftKey: true,
    })
    expect([...res.selected].sort()).toEqual(['a', 'c'])
    expect(res.anchorId).toBe('c')
  })

  it('leaves state unchanged when clickedId is not in visibleIds', () => {
    const res = applyMultiSelect({
      visibleIds,
      selected: new Set(['a']),
      anchorId: 'a',
      clickedId: 'unknown',
      shiftKey: true,
    })
    expect([...res.selected]).toEqual(['a'])
    expect(res.anchorId).toBe('a')
  })
})
