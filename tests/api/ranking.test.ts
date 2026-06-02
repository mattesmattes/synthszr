import { describe, it, expect } from 'vitest'

const API_BASE = process.env.TEST_API_URL || 'https://synthszr.vercel.app'

describe('Ranking API', () => {
  it('GET returns the latest run shape (or 401 if gated)', async () => {
    const res = await fetch(`${API_BASE}/api/admin/ranking`)
    expect([200, 401]).toContain(res.status)
    if (res.status === 200) {
      const data = await res.json()
      expect(data).toHaveProperty('suggestions')
      expect(Array.isArray(data.suggestions)).toBe(true)
    }
  })
})
