import { describe, it, expect } from 'vitest'

const API_BASE = process.env.TEST_API_URL || 'https://synthszr.vercel.app'

describe('Bundle Type API', () => {
  it('returns 401 without auth (PATCH)', async () => {
    const response = await fetch(`${API_BASE}/api/admin/news-queue/bundle-type`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'test-id', bundle_type: 'topic' }),
    })
    expect(response.status).toBe(401)
  })
})
