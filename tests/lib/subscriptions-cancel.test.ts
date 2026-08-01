import { describe, it, expect, vi } from 'vitest'
import { executeAutoUnsubscribe } from '@/lib/subscriptions/cancel'

describe('executeAutoUnsubscribe', () => {
  it('oneclick → POST auf target, ok bei 2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const r = await executeAutoUnsubscribe('oneclick', 'https://x.com/u', fetchFn as unknown as typeof fetch)
    expect(fetchFn).toHaveBeenCalledWith('https://x.com/u', expect.objectContaining({ method: 'POST' }))
    expect(r.ok).toBe(true)
  })
  it('http → GET auf target', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const r = await executeAutoUnsubscribe('http', 'https://x.com/u', fetchFn as unknown as typeof fetch)
    expect(fetchFn).toHaveBeenCalledWith('https://x.com/u', expect.objectContaining({ method: 'GET' }))
    expect(r.ok).toBe(true)
  })
  it('non-2xx → ok=false', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const r = await executeAutoUnsubscribe('oneclick', 'https://x.com/u', fetchFn as unknown as typeof fetch)
    expect(r.ok).toBe(false)
  })
  it('nicht-automatischer Typ (mailto/login_portal) → ok=false, kein fetch', async () => {
    const fetchFn = vi.fn()
    const r = await executeAutoUnsubscribe('mailto', 'mailto:a@x.com', fetchFn as unknown as typeof fetch)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(r.ok).toBe(false)
  })
})
