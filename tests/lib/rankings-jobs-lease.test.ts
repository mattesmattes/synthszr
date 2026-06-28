import { describe, it, expect } from 'vitest'
import { LEASE_STALE_MS, isLeaseStale, staleBeforeIso } from '@/lib/rankings/jobs-lease'

describe('isLeaseStale', () => {
  const now = 1_700_000_000_000
  it('null-Stempel ist stale', () => { expect(isLeaseStale(null, now)).toBe(true) })
  it('frischer Stempel ist nicht stale', () => {
    expect(isLeaseStale(new Date(now - 60_000).toISOString(), now)).toBe(false)
  })
  it('alter Stempel ist stale', () => {
    expect(isLeaseStale(new Date(now - LEASE_STALE_MS - 1000).toISOString(), now)).toBe(true)
  })
})

describe('staleBeforeIso', () => {
  it('liegt LEASE_STALE_MS in der Vergangenheit', () => {
    const now = 1_700_000_000_000
    expect(staleBeforeIso(now)).toBe(new Date(now - LEASE_STALE_MS).toISOString())
  })
})
