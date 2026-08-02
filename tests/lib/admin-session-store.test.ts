/**
 * Opaque, revocable admin sessions (SEC-015).
 *
 * The previous session was a self-contained JWT: valid for 7 days, verifiable
 * by anyone holding JWT_SECRET, and impossible to revoke. Logging out only
 * deleted the cookie - the token itself stayed valid until it expired, so a
 * copy taken from a browser, a proxy log or a backup kept working. Rotating
 * the secret was the only way to invalidate anything, and that logs everyone
 * out at once.
 *
 * Sessions are now random tokens whose SHA-256 hash is a row in the database:
 * revocable individually, expiring in 12 hours, and worthless to read out of
 * the table.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  error: null as unknown,
  inserts: [] as any[],
  updates: [] as any[],
  filters: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const filters: Record<string, unknown> = {}
      state.filters.push(filters)
      let mode: 'select' | 'insert' | 'update' = 'select'
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: unknown) => { filters[c] = v; return chain },
        is: (c: string, v: unknown) => { filters[c] = v; return chain },
        gt: (c: string, v: unknown) => { filters[`gt:${c}`] = v; return chain },
        insert: (row: any) => { mode = 'insert'; state.inserts.push(row); return chain },
        update: (row: any) => { mode = 'update'; state.updates.push({ row, filters }); return chain },
      }
      const resolve = async () => {
        if (mode === 'insert' || mode === 'update') return { data: null, error: state.error }
        return { data: state.row, error: state.error }
      }
      chain.maybeSingle = resolve
      chain.single = resolve
      chain.then = (f: any) => resolve().then(f)
      return chain
    },
  }),
}))

import {
  createSession,
  verifySession,
  revokeSession,
  hashSessionToken,
  ADMIN_SESSION_TTL_SECONDS,
} from '@/lib/auth/session-store'

beforeEach(() => {
  state.row = null
  state.error = null
  state.inserts.length = 0
  state.updates.length = 0
  state.filters.length = 0
})

describe('creating a session', () => {
  it('returns a 256-bit random token', async () => {
    const token = await createSession()
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  })

  it('never repeats a token', async () => {
    const tokens = new Set(await Promise.all(Array.from({ length: 30 }, () => createSession())))
    expect(tokens.size).toBe(30)
  })

  it('stores only the hash, never the token', async () => {
    const token = await createSession('admin@example.com', 'Admin')

    expect(state.inserts).toHaveLength(1)
    const row = state.inserts[0]
    expect(row.token_hash).toBe(await hashSessionToken(token))
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(row)).not.toContain(token)
  })

  it('expires after 12 hours', async () => {
    await createSession()
    const expires = Date.parse(state.inserts[0].expires_at as string)
    const hours = Math.round((expires - Date.now()) / 3_600_000)
    expect(hours).toBe(12)
    expect(ADMIN_SESSION_TTL_SECONDS).toBe(12 * 60 * 60)
  })

  it('records the identity for google logins', async () => {
    await createSession('admin@example.com', 'Admin')
    expect(state.inserts[0]).toMatchObject({ email: 'admin@example.com', name: 'Admin', is_admin: true })
  })
})

describe('verifying a session', () => {
  const VALID = { subscriber: undefined, is_admin: true, email: 'a@b.c', name: 'A', expires_at: new Date(Date.now() + 3_600_000).toISOString() }

  it('accepts a token whose hash is an active row', async () => {
    state.row = VALID
    const result = await verifySession('some-token')
    expect(result).toMatchObject({ isAdmin: true, email: 'a@b.c', name: 'A' })
    expect(result?.expiresAt).toBeInstanceOf(Date)
  })

  it('looks up by hash, not by the raw token', async () => {
    state.row = VALID
    await verifySession('raw-secret-token')

    const serialized = JSON.stringify(state.filters)
    expect(serialized).toContain(await hashSessionToken('raw-secret-token'))
    expect(serialized).not.toContain('raw-secret-token')
  })

  it('constrains the query to unrevoked, unexpired, admin rows', async () => {
    state.row = VALID
    await verifySession('t')

    const [filters] = state.filters
    expect(filters['revoked_at']).toBeNull()
    expect(filters['is_admin']).toBe(true)
    expect(filters['gt:expires_at']).toEqual(expect.any(String))
  })

  it('rejects an unknown token', async () => {
    state.row = null
    await expect(verifySession('nope')).resolves.toBeNull()
  })

  it('rejects an empty token without touching the database', async () => {
    await expect(verifySession('')).resolves.toBeNull()
    expect(state.filters).toHaveLength(0)
  })

  it('fails closed on a database error', async () => {
    state.row = null
    state.error = { message: 'connection refused' }
    await expect(verifySession('t')).resolves.toBeNull()
  })
})

describe('revoking a session', () => {
  it('marks the row revoked so the cookie value stops working', async () => {
    await revokeSession('token-to-kill')

    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].row).toMatchObject({ revoked_at: expect.any(String) })
    expect(state.updates[0].filters['token_hash']).toBe(await hashSessionToken('token-to-kill'))
  })

  it('does nothing for an empty token', async () => {
    await revokeSession('')
    expect(state.updates).toHaveLength(0)
  })
})

describe('hashing', () => {
  it('is deterministic and collision-distinct', async () => {
    expect(await hashSessionToken('a')).toBe(await hashSessionToken('a'))
    expect(await hashSessionToken('a')).not.toBe(await hashSessionToken('b'))
  })

  it('uses Web Crypto so the middleware can call it in any runtime', async () => {
    // node:crypto is unavailable in the edge runtime; a Node-only hash here
    // would make every /admin request throw in middleware.
    const source = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('../../lib/auth/session-store.ts', import.meta.url), 'utf8')
    )
    expect(source).toContain('crypto.subtle.digest')
    expect(source).not.toMatch(/from 'node:crypto'|from 'crypto'/)
  })
})
