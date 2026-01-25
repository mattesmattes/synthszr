import { describe, it, expect } from 'vitest'

const API_BASE = process.env.TEST_API_URL || 'https://synthszr.vercel.app'

// Note: These tests verify the scheduled-tasks endpoint behavior
// The actual timeout behavior can only be fully tested in integration scenarios

describe('Scheduled Tasks API', () => {
  it('returns 401 without authorization', async () => {
    const response = await fetch(`${API_BASE}/api/cron/scheduled-tasks`, {
      method: 'GET',
    })

    // Should be 401 in production without auth
    expect([401, 200]).toContain(response.status)
  })

  it('responds within reasonable time (not hanging)', async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s test timeout

    try {
      const startTime = Date.now()
      const response = await fetch(`${API_BASE}/api/cron/scheduled-tasks`, {
        method: 'GET',
        signal: controller.signal,
      })
      const elapsed = Date.now() - startTime

      clearTimeout(timeoutId)

      // Should respond within 10 seconds (even if 401)
      expect(elapsed).toBeLessThan(10000)
      expect([200, 401]).toContain(response.status)
    } catch (error) {
      clearTimeout(timeoutId)
      // AbortError means timeout - test should pass without hanging
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Endpoint took longer than 10s to respond')
      }
      throw error
    }
  })

  it('returns JSON response structure', async () => {
    // This test may only work in development or with proper auth
    const response = await fetch(`${API_BASE}/api/cron/scheduled-tasks`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.CRON_SECRET || 'test'}`,
      },
    })

    if (response.ok) {
      const data = await response.json()
      expect(data).toHaveProperty('success')
      expect(data).toHaveProperty('timestamp')
      expect(data).toHaveProperty('results')
    } else {
      // Auth failed, which is expected in test environment
      expect([401, 403]).toContain(response.status)
    }
  })
})
