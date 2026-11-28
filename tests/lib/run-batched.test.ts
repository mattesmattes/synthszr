import { describe, it, expect, vi } from 'vitest'
import { runBatched } from '@/lib/admin/run-batched'

describe('runBatched', () => {
  it('returns empty result for empty input', async () => {
    const onProgress = vi.fn()
    const res = await runBatched([], async () => {}, { onProgress })
    expect(res).toEqual({ succeeded: 0, failed: [] })
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('bounds concurrency to the configured limit', async () => {
    let active = 0
    let maxActive = 0
    const items = [1, 2, 3, 4, 5, 6, 7]

    const res = await runBatched(
      items,
      async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((r) => setTimeout(r, 10))
        active -= 1
      },
      { concurrency: 3 },
    )

    expect(res).toEqual({ succeeded: 7, failed: [] })
    expect(maxActive).toBeLessThanOrEqual(3)
    expect(maxActive).toBeGreaterThanOrEqual(2)
  })

  it('collects failures without aborting remaining items and reports progress', async () => {
    const progressCalls: Array<[number, number]> = []
    const items = ['a', 'b', 'c', 'd']

    const res = await runBatched(
      items,
      async (item) => {
        if (item === 'b') throw new Error('boom-b')
        if (item === 'd') throw 'boom-d'
      },
      {
        concurrency: 1,
        onProgress: (done, total) => progressCalls.push([done, total]),
      },
    )

    expect(res.succeeded).toBe(2)
    expect(res.failed).toEqual([
      { item: 'b', error: 'boom-b' },
      { item: 'd', error: 'boom-d' },
    ])
    expect(progressCalls).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ])
  })
})
