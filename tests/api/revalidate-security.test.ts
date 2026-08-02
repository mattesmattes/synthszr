/**
 * The rankings cache endpoint used to authenticate with `?secret=` compared
 * against the last 16 characters of SUPABASE_SERVICE_ROLE_KEY (SEC-014):
 * a URL-borne credential (logged by every proxy and access log) that is also
 * a substring of the most powerful secret in the system. It now takes its own
 * bearer secret and nothing else.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  rateLimitSuccess: true,
}))

vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }))

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({
      success: mocks.rateLimitSuccess,
      remaining: mocks.rateLimitSuccess ? 9 : 0,
      reset: 1,
      limit: 10,
    })),
  }
})

import { POST } from '@/app/api/revalidate-rankings/route'

const SECRET = 'revalidate-secret-value'
const SERVICE_ROLE_KEY = 'service-role-key-with-a-recognizable-suffix'

function post(init?: { headers?: Record<string, string>; query?: string }) {
  return POST(
    new Request(`http://localhost/api/revalidate-rankings${init?.query ?? ''}`, {
      method: 'POST',
      headers: init?.headers,
    }) as never
  )
}

beforeEach(() => {
  mocks.revalidateTag.mockReset()
  mocks.rateLimitSuccess = true
  process.env.REVALIDATE_SECRET = SECRET
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY
})

afterEach(() => {
  delete process.env.REVALIDATE_SECRET
})

describe('POST /api/revalidate-rankings', () => {
  it('revalidates for the correct bearer secret', async () => {
    const response = await post({ headers: { authorization: `Bearer ${SECRET}` } })

    expect(response.status).toBe(200)
    expect(mocks.revalidateTag).toHaveBeenCalledWith('rankings', 'max')
  })

  it('rejects a request with no credentials', async () => {
    const response = await post()

    expect(response.status).toBe(401)
    expect(mocks.revalidateTag).not.toHaveBeenCalled()
  })

  it('rejects a wrong bearer secret', async () => {
    const response = await post({ headers: { authorization: 'Bearer wrong-secret-value' } })

    expect(response.status).toBe(401)
    expect(mocks.revalidateTag).not.toHaveBeenCalled()
  })

  it('no longer accepts the secret as a query parameter', async () => {
    const response = await post({ query: `?secret=${SECRET}` })

    expect(response.status).toBe(401)
    expect(mocks.revalidateTag).not.toHaveBeenCalled()
  })

  it('no longer accepts the service-role-key suffix as a credential', async () => {
    const suffix = SERVICE_ROLE_KEY.slice(-16)

    const viaQuery = await post({ query: `?secret=${suffix}` })
    const viaBearer = await post({ headers: { authorization: `Bearer ${suffix}` } })

    expect(viaQuery.status).toBe(401)
    expect(viaBearer.status).toBe(401)
    expect(mocks.revalidateTag).not.toHaveBeenCalled()
  })

  it('rejects when REVALIDATE_SECRET is unset instead of failing open', async () => {
    delete process.env.REVALIDATE_SECRET

    const response = await post({ headers: { authorization: 'Bearer ' } })

    expect(response.status).toBe(401)
    expect(mocks.revalidateTag).not.toHaveBeenCalled()
  })

  it('rate limits before doing any cache work', async () => {
    mocks.rateLimitSuccess = false

    const response = await post({ headers: { authorization: `Bearer ${SECRET}` } })

    expect(response.status).toBe(429)
    expect(mocks.revalidateTag).not.toHaveBeenCalled()
  })
})
