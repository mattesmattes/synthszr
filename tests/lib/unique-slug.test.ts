import { describe, it, expect } from 'vitest'
import { buildUniqueSlug } from '@/lib/article-jobs/unique-slug'

describe('buildUniqueSlug', () => {
  it('returns the base slug when it does not exist', async () => {
    const slug = await buildUniqueSlug('mein-artikel', async () => false)
    expect(slug).toBe('mein-artikel')
  })

  it('appends -2 when the base exists', async () => {
    const taken = new Set(['mein-artikel'])
    const slug = await buildUniqueSlug('mein-artikel', async s => taken.has(s))
    expect(slug).toBe('mein-artikel-2')
  })

  it('increments until a free slug is found', async () => {
    const taken = new Set(['x', 'x-2', 'x-3'])
    const slug = await buildUniqueSlug('x', async s => taken.has(s))
    expect(slug).toBe('x-4')
  })

  it('does not loop forever (caps attempts and falls back to a distinct suffix)', async () => {
    // existsFn always true → must terminate with a non-base, distinct slug
    const slug = await buildUniqueSlug('y', async () => true)
    expect(slug).not.toBe('y')
    expect(slug.startsWith('y-')).toBe(true)
  })
})
