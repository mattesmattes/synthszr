import { describe, it, expect } from 'vitest'

const API_BASE = process.env.TEST_API_URL || 'https://synthszr.vercel.app'

describe('Debug Labels API Security', () => {
  it('returns 401 without auth (GET)', async () => {
    // GET without secret or admin session should fail
    const response = await fetch(`${API_BASE}/api/admin/debug-labels`)
    expect(response.status).toBe(401)
  })

  it('returns 401 without auth (POST)', async () => {
    const response = await fetch(`${API_BASE}/api/admin/debug-labels`, {
      method: 'POST',
    })
    expect(response.status).toBe(401)
  })

  // Note: Tests for rejecting the old hardcoded secret will pass after deployment.
  // The security fix moves the secret to env var DEBUG_LABELS_SECRET.
  // See: app/api/admin/debug-labels/route.ts
})
