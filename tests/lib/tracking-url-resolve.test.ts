/**
 * Tracking-redirect resolution must run through the SSRF guard (SEC-004).
 *
 * These URLs come out of crawled newsletters - the least trusted input the
 * crawler handles - and used to be followed with a bare fetch({redirect:
 * 'follow'}), which re-resolves every hop internally with no policy at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/security/ssrf', () => ({ safeFetch: vi.fn() }))
vi.mock('@/lib/gmail/client', () => ({ GmailClient: class {} }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/embeddings/backfill', () => ({ backfillMissingEmbeddings: vi.fn() }))

import { resolveTrackingUrl } from '@/lib/webcrawl/processor'
import { safeFetch } from '@/lib/security/ssrf'

const TRACKING_URL = 'https://link.mail.beehiiv.com/ss/c/abc123'

beforeEach(() => {
  vi.mocked(safeFetch).mockReset()
})

describe('resolveTrackingUrl', () => {
  it('follows a tracking redirect through safeFetch with HEAD and a 5s budget', async () => {
    vi.mocked(safeFetch).mockResolvedValue({ url: 'https://example.com/real-article' } as Response)

    const result = await resolveTrackingUrl(TRACKING_URL)

    expect(safeFetch).toHaveBeenCalledWith(
      TRACKING_URL,
      expect.objectContaining({ method: 'HEAD', timeoutMs: 5000 })
    )
    expect(result).toBe('https://example.com/real-article')
  })

  it('keeps the original URL when the guard blocks a hop', async () => {
    vi.mocked(safeFetch).mockRejectedValue(new Error('SSRF blocked: target resolves to a reserved address'))

    const result = await resolveTrackingUrl(TRACKING_URL)

    expect(result).toBe(TRACKING_URL)
  })

  it('does not make any request for a non-tracking URL', async () => {
    const result = await resolveTrackingUrl('https://example.com/plain-article')

    expect(safeFetch).not.toHaveBeenCalled()
    expect(result).toBe('https://example.com/plain-article')
  })
})
