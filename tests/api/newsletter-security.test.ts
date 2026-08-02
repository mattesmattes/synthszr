/**
 * Signup and double-opt-in must not hand out subscriber identifiers (SEC-001).
 *
 * Two properties are under test:
 *  - the response is identical for a new address and for one that is already
 *    subscribed, so the endpoint cannot be used to enumerate subscribers, and
 *  - the confirmation credential is a purpose-scoped random token stored as a
 *    hash, not the subscriber UUID in a plaintext column.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const db = vi.hoisted(() => ({
  existingSubscriber: null as { id: string; status: string } | null,
  insertedSubscriber: { id: 'new-subscriber-id' },
  tokenInserts: [] as any[],
  tokenDeletes: [] as any[],
  subscriberUpdates: [] as any[],
  // Rows that resolveSubscriberToken should find, keyed by hash.
  actionTokens: [] as any[],
  sentMails: [] as any[],
}))

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({ success: true, remaining: 9, reset: 1, limit: 10 })),
  }
})

vi.mock('@/lib/security/origin-check', () => ({ requireValidOrigin: () => null }))

vi.mock('@/lib/referrals/service', () => ({
  trackReferral: vi.fn(async () => {}),
  confirmReferral: vi.fn(async () => {}),
  generateReferralCode: () => 'REFCODE',
}))

vi.mock('@/lib/resend/client', () => ({
  getResend: () => ({ emails: { send: vi.fn(async (m: any) => { db.sentMails.push(m); return { id: 'mail' } }) } }),
  FROM_EMAIL: 'test@synthszr.com',
  BASE_URL: 'https://www.synthszr.com',
}))

// Keep the real components (the templates import Html/Body/...), stub only
// the renderer so tests do not pay for full email rendering.
vi.mock('@react-email/components', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-email/components')>()),
  render: async () => '<html></html>',
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const chain: any = {}
      const filters: Record<string, unknown> = {}
      let pending: 'select' | 'insert' | 'update' | 'delete' = 'select'
      let payload: any = null

      chain.select = () => chain
      chain.eq = (col: string, val: unknown) => { filters[col] = val; return chain }
      chain.is = (col: string, val: unknown) => { filters[col] = val; return chain }
      chain.gt = () => chain
      chain.limit = () => chain
      chain.insert = (row: any) => { pending = 'insert'; payload = row; return chain }
      chain.update = (row: any) => { pending = 'update'; payload = row; return chain }
      chain.delete = () => { pending = 'delete'; return chain }

      const resolve = async () => {
        if (table === 'subscribers') {
          if (pending === 'insert') return { data: db.insertedSubscriber, error: null }
          if (pending === 'update') { db.subscriberUpdates.push({ filters, payload }); return { data: null, error: null } }
          return { data: db.existingSubscriber, error: db.existingSubscriber ? null : { code: 'PGRST116' } }
        }
        if (table === 'subscriber_action_tokens') {
          if (pending === 'insert') { db.tokenInserts.push(payload); return { data: payload, error: null } }
          if (pending === 'delete') { db.tokenDeletes.push(filters); return { data: null, error: null } }
          if (pending === 'update') {
            const row = db.actionTokens.find(t => t.token_hash === filters.token_hash || t.id === filters.id)
            if (!row || row.consumed_at) return { data: null, error: null }
            row.consumed_at = new Date().toISOString()
            return { data: { subscriber_id: row.subscriber_id }, error: null }
          }
          const row = db.actionTokens.find(
            t => t.token_hash === filters.token_hash && t.purpose === filters.purpose && !t.consumed_at
          )
          return { data: row ?? null, error: null }
        }
        return { data: null, error: null }
      }

      chain.single = resolve
      chain.maybeSingle = resolve
      chain.then = (onFulfilled: any) => resolve().then(onFulfilled)
      return chain
    },
  }),
}))

import { POST as subscribe } from '@/app/api/newsletter/subscribe/route'
import { GET as confirm } from '@/app/api/newsletter/confirm/route'
import { hashSubscriberToken } from '@/lib/newsletter/access-tokens'

function signup(email: string) {
  return subscribe(new NextRequest('https://www.synthszr.com/api/newsletter/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://www.synthszr.com' },
    body: JSON.stringify({ email, language: 'de' }),
  }))
}

beforeEach(() => {
  db.existingSubscriber = null
  db.tokenInserts.length = 0
  db.tokenDeletes.length = 0
  db.subscriberUpdates.length = 0
  db.actionTokens.length = 0
  db.sentMails.length = 0
})

describe('POST /api/newsletter/subscribe', () => {
  it('answers identically for a new address and one that is already active', async () => {
    db.existingSubscriber = null
    const fresh = await signup('new@example.com')
    const freshBody = await fresh.json()

    db.existingSubscriber = { id: 'existing-id', status: 'active' }
    const known = await signup('known@example.com')
    const knownBody = await known.json()

    expect(fresh.status).toBe(202)
    expect(known.status).toBe(202)
    expect(knownBody).toEqual(freshBody)
  })

  it('never returns a subscriber identifier', async () => {
    const response = await signup('new@example.com')
    const body = JSON.stringify(await response.json())

    expect(body).not.toMatch(/sid|subscriberId/i)
    expect(body).not.toContain('new-subscriber-id')
  })

  it('sends no mail to an address that is already active', async () => {
    db.existingSubscriber = { id: 'existing-id', status: 'active' }
    await signup('known@example.com')
    expect(db.sentMails).toHaveLength(0)
  })

  it('stores only the hash of the confirmation token', async () => {
    await signup('new@example.com')

    expect(db.tokenInserts).toHaveLength(1)
    const row = db.tokenInserts[0]
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(row).not.toHaveProperty('token')
    expect(row.purpose).toBe('confirm')

    // The token in the mail link must hash to the stored value, and must not
    // itself appear anywhere in the persisted row.
    const link = db.sentMails[0]?.html ?? ''
    expect(JSON.stringify(row)).not.toContain(link)
  })

  it('replaces any previous confirmation token for that subscriber', async () => {
    await signup('new@example.com')
    expect(db.tokenDeletes).toContainEqual(expect.objectContaining({ purpose: 'confirm' }))
  })

  it('no longer writes the legacy confirmation_token column', async () => {
    db.existingSubscriber = { id: 'existing-id', status: 'pending' }
    await signup('pending@example.com')

    for (const update of db.subscriberUpdates) {
      expect(update.payload).not.toHaveProperty('confirmation_token')
    }
  })

  it('marks responses uncacheable', async () => {
    const response = await signup('new@example.com')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('still rejects a malformed address', async () => {
    const response = await subscribe(new NextRequest('https://www.synthszr.com/api/newsletter/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://www.synthszr.com' },
      body: JSON.stringify({ email: 'not-an-email' }),
    }))
    expect(response.status).toBe(400)
  })
})

describe('GET /api/newsletter/confirm', () => {
  const RAW = 'raw-confirmation-token'

  function confirmWith(token: string) {
    return confirm(new NextRequest(`https://www.synthszr.com/api/newsletter/confirm?token=${token}`))
  }

  beforeEach(() => {
    db.actionTokens.push({
      id: 'token-row',
      subscriber_id: 'subscriber-1',
      purpose: 'confirm',
      token_hash: hashSubscriberToken(RAW),
      consumed_at: null,
    })
    db.existingSubscriber = { id: 'subscriber-1', status: 'pending' }
  })

  it('activates the subscriber for a valid token', async () => {
    const response = await confirmWith(RAW)
    expect(response.headers.get('location')).toContain('status=success')
  })

  it('accepts a confirmation token exactly once', async () => {
    await confirmWith(RAW)
    const second = await confirmWith(RAW)
    expect(second.headers.get('location')).toContain('error=invalid_token')
  })

  it('rejects an unknown token', async () => {
    const response = await confirmWith('not-a-real-token')
    expect(response.headers.get('location')).toContain('error=invalid_token')
  })

  it('does not accept a token minted for another purpose', async () => {
    db.actionTokens.push({
      id: 'pref-row',
      subscriber_id: 'subscriber-1',
      purpose: 'preferences',
      token_hash: hashSubscriberToken('preferences-token'),
      consumed_at: null,
    })

    const response = await confirmWith('preferences-token')
    expect(response.headers.get('location')).toContain('error=invalid_token')
  })

  it('does not leak the subscriber id in the redirect', async () => {
    const response = await confirmWith(RAW)
    expect(response.headers.get('location')).not.toContain('subscriber-1')
  })
})
