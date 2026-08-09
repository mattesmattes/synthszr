/**
 * Hashed, purpose-scoped subscriber tokens (SEC-001).
 *
 * Today a subscriber's UUID is the credential: it travels in newsletter links,
 * query parameters and localStorage, never expires, cannot be revoked, and is
 * the same value for every action. These tokens replace it - random per
 * purpose, expiring, and stored only as a SHA-256 hash so a database read
 * does not yield anything usable.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const SUBSCRIBER = '018f6f4e-2dd3-7a13-a200-111111111111'

// A minimal stand-in for the PostgREST builder: every filter returns the
// chain, the terminal call resolves. Filters are vi.fn()s so tests can assert
// which constraints the lookup actually applied - that is the security
// property, not the return value.
const state = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown }, chains: [] as any[] }))

function makeChain() {
  const chain: any = {}
  for (const method of ['select', 'eq', 'is', 'gt', 'update', 'insert', 'delete', 'limit', 'order']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn(async () => state.result)
  chain.single = vi.fn(async () => state.result)
  state.chains.push(chain)
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: vi.fn(() => makeChain()) }),
}))

import {
  hashSubscriberToken,
  mintSubscriberToken,
  resolveSubscriberToken,
} from '@/lib/newsletter/access-tokens'

beforeEach(() => {
  state.result = { data: null, error: null }
  state.chains.length = 0
})

describe('minting', () => {
  it('mints 256-bit opaque tokens and persists only the hash', () => {
    const minted = mintSubscriberToken(SUBSCRIBER, 'preferences', new Date('2026-08-09T00:00:00Z'))

    expect(Buffer.from(minted.rawToken, 'base64url')).toHaveLength(32)
    expect(minted.row.token_hash).toBe(hashSubscriberToken(minted.rawToken))
    expect(minted.row.token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(minted.row)).not.toContain(minted.rawToken)
  })

  it('never repeats a token', () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => mintSubscriberToken(SUBSCRIBER, 'confirm', new Date()).rawToken)
    )
    expect(tokens.size).toBe(50)
  })

  it('separates token purpose', () => {
    const p = mintSubscriberToken(SUBSCRIBER, 'preferences', new Date())
    expect(p.row.purpose).toBe('preferences')
    expect(p.row.subscriber_id).toBe(SUBSCRIBER)
  })

  it('hashes deterministically so a lookup can find the row', () => {
    const minted = mintSubscriberToken(SUBSCRIBER, 'unsubscribe', new Date())
    expect(hashSubscriberToken(minted.rawToken)).toBe(hashSubscriberToken(minted.rawToken))
    expect(hashSubscriberToken('other-token')).not.toBe(hashSubscriberToken(minted.rawToken))
  })
})

describe('resolving', () => {
  it('looks the token up by hash, purpose, unconsumed and unexpired', async () => {
    state.result = { data: { id: 'row-1', subscriber_id: SUBSCRIBER }, error: null }

    await resolveSubscriberToken('some-raw-token', 'preferences')

    const [lookup] = state.chains
    expect(lookup.eq).toHaveBeenCalledWith('token_hash', hashSubscriberToken('some-raw-token'))
    expect(lookup.eq).toHaveBeenCalledWith('purpose', 'preferences')
    expect(lookup.is).toHaveBeenCalledWith('consumed_at', null)
    expect(lookup.gt).toHaveBeenCalledWith('expires_at', expect.any(String))
  })

  it('never sends the raw token to the database', async () => {
    state.result = { data: { id: 'row-1', subscriber_id: SUBSCRIBER }, error: null }

    await resolveSubscriberToken('super-secret-raw', 'preferences')

    const calls = JSON.stringify(state.chains.map(c => c.eq.mock.calls))
    expect(calls).not.toContain('super-secret-raw')
  })

  it('returns the subscriber for a valid token', async () => {
    state.result = { data: { id: 'row-1', subscriber_id: SUBSCRIBER }, error: null }
    await expect(resolveSubscriberToken('t', 'preferences')).resolves.toEqual({ subscriberId: SUBSCRIBER })
  })

  it('returns null for an unknown token', async () => {
    state.result = { data: null, error: null }
    await expect(resolveSubscriberToken('nope', 'preferences')).resolves.toBeNull()
  })

  it('returns null on a database error instead of failing open', async () => {
    state.result = { data: null, error: { message: 'boom' } }
    await expect(resolveSubscriberToken('t', 'preferences')).resolves.toBeNull()
  })

  it('does not accept a token minted for a different purpose', async () => {
    // The purpose is part of the lookup, so a preferences token simply does
    // not match an unsubscribe query - the DB returns nothing.
    state.result = { data: null, error: null }
    await expect(resolveSubscriberToken('preferences-token', 'unsubscribe')).resolves.toBeNull()

    const [lookup] = state.chains
    expect(lookup.eq).toHaveBeenCalledWith('purpose', 'unsubscribe')
  })
})

describe('consuming', () => {
  it('marks the row consumed and returns the subscriber', async () => {
    state.result = { data: { id: 'row-1', subscriber_id: SUBSCRIBER }, error: null }

    const result = await resolveSubscriberToken('t', 'confirm', { consume: true })

    expect(result).toEqual({ subscriberId: SUBSCRIBER })
    const update = state.chains.find(c => c.update.mock.calls.length > 0)
    expect(update, 'expected an update call').toBeDefined()
    expect(update!.update).toHaveBeenCalledWith(expect.objectContaining({ consumed_at: expect.any(String) }))
    expect(update!.eq).toHaveBeenCalledWith('id', 'row-1')
    // Guards the race: a concurrent consumer must not be able to win twice.
    expect(update!.is).toHaveBeenCalledWith('consumed_at', null)
  })

  it('returns null when a concurrent request consumed it first', async () => {
    let call = 0
    state.result = { data: { id: 'row-1', subscriber_id: SUBSCRIBER }, error: null }
    const original = state.result
    // First call (lookup) finds the row, second call (conditional update)
    // affects nothing because the other request already set consumed_at.
    Object.defineProperty(state, 'result', {
      configurable: true,
      get: () => (++call <= 1 ? original : { data: null, error: null }),
      set: () => {},
    })

    await expect(resolveSubscriberToken('t', 'confirm', { consume: true })).resolves.toBeNull()
  })

  it('leaves the row untouched when not consuming', async () => {
    state.result = { data: { id: 'row-1', subscriber_id: SUBSCRIBER }, error: null }

    await resolveSubscriberToken('t', 'preferences')

    expect(state.chains.every(c => c.update.mock.calls.length === 0)).toBe(true)
  })
})

describe('newsletter batch minting', () => {
  it('mints one token per purpose for every recipient', async () => {
    const { mintNewsletterLinkTokens } = await import('@/lib/newsletter/access-tokens')
    const recipients = ['sub-1', 'sub-2', 'sub-3']

    const { bySubscriber, rows } = mintNewsletterLinkTokens(recipients)

    // four purposes per recipient (comment seit 2026-08-09), ein Insert-Payload
    expect(rows).toHaveLength(recipients.length * 4)
    expect(bySubscriber.size).toBe(3)

    const first = bySubscriber.get('sub-1')!
    expect(first.preferences.row.purpose).toBe('preferences')
    expect(first.unsubscribe.row.purpose).toBe('unsubscribe')
    expect(first.referral.row.purpose).toBe('referral')
  })

  it('gives every recipient distinct tokens', async () => {
    const { mintNewsletterLinkTokens } = await import('@/lib/newsletter/access-tokens')
    const { rows } = mintNewsletterLinkTokens(['a', 'b', 'c'])
    expect(new Set(rows.map(r => r.token_hash)).size).toBe(rows.length)
  })

  it('uses the documented lifetimes per purpose', async () => {
    const { mintNewsletterLinkTokens } = await import('@/lib/newsletter/access-tokens')
    const { bySubscriber } = mintNewsletterLinkTokens(['sub-1'])
    const t = bySubscriber.get('sub-1')!

    const days = (iso: string) => Math.round((Date.parse(iso) - Date.now()) / 86400000)
    expect(days(t.preferences.row.expires_at)).toBe(7)
    expect(days(t.referral.row.expires_at)).toBe(30)
    expect(days(t.unsubscribe.row.expires_at)).toBe(90)
  })

  it('persists no raw token in the insert payload', async () => {
    const { mintNewsletterLinkTokens } = await import('@/lib/newsletter/access-tokens')
    const { bySubscriber, rows } = mintNewsletterLinkTokens(['sub-1'])
    const raws = Object.values(bySubscriber.get('sub-1')!).map(t => t.rawToken)

    const serialized = JSON.stringify(rows)
    for (const raw of raws) expect(serialized).not.toContain(raw)
  })
})

// „Eure Takes" (2026-08-09): Newsletter-Links tragen einen comment-Token —
// wer aus der Mail klickt, kommentiert ohne weitere Bestätigung. Der Token
// gehört in DENSELBEN Batch-Mint wie die drei bestehenden: ein vierter
// Roundtrip pro Empfänger würde die Versandzeit dominieren (gleiche
// Begründung wie im Modul-Kommentar von mintNewsletterLinkTokens).
describe('comment-Token im Newsletter-Batch', () => {
  it('muenzt vier Tokens je Empfaenger, inklusive purpose comment', async () => {
    const { mintNewsletterLinkTokens } = await import('@/lib/newsletter/access-tokens')
    const { bySubscriber, rows } = mintNewsletterLinkTokens(['sub-1'])
    const tokens = bySubscriber.get('sub-1')!
    expect(tokens.comment.row.purpose).toBe('comment')
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.purpose).sort()).toEqual(['comment', 'preferences', 'referral', 'unsubscribe'])
  })

  it('comment-Token laeuft nach 7 Tagen ab — kurz, weil er in der URL steht', async () => {
    const { mintNewsletterLinkTokens } = await import('@/lib/newsletter/access-tokens')
    const { bySubscriber } = mintNewsletterLinkTokens(['sub-1'])
    const expires = new Date(bySubscriber.get('sub-1')!.comment.row.expires_at).getTime()
    const days = (expires - Date.now()) / 86400_000
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)
  })
})
