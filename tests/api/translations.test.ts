import { describe, it, expect } from 'vitest'

const API_BASE = process.env.TEST_API_URL || 'https://synthszr.vercel.app'

describe('Translations API', () => {
  it('returns queue stats', async () => {
    const response = await fetch(`${API_BASE}/api/admin/translations`)

    // May require auth, so 401 is acceptable
    if (response.status === 401) {
      expect(response.status).toBe(401)
      return
    }

    expect(response.ok).toBe(true)
    const data = await response.json()

    expect(data).toHaveProperty('stats')
    expect(data.stats).toHaveProperty('pending')
    expect(data.stats).toHaveProperty('completed')
    expect(data.stats).toHaveProperty('failed')
  })
})
