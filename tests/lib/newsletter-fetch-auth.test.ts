/**
 * PROD-BEFUND 2026-11-07: Das Gmail-Token war von 04:00 bis 06:34 ungueltig
 * (invalid_grant). Der Abruf fing den Fehler pro Batch ab, meldete
 * `success: true` mit 0 Mails — fuer den Scheduler sah das aus wie „Post noch
 * nicht da". Die Tagesanalyse lief um 04:16 mit altem Material los, die Queue
 * bekam 65 statt ~700 Items.
 *
 * Regel: Ist Gmail nicht erreichbar, ist der Abruf GESCHEITERT, nicht leer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProfile = vi.fn()
const fetchEmailsFromSenders = vi.fn()

vi.mock('@/lib/gmail/client', () => ({
  GmailClient: class {
    getProfile = getProfile
    fetchEmailsFromSenders = fetchEmailsFromSenders
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const result = table === 'gmail_tokens'
        ? { data: { refresh_token: 'rt' }, error: null }
        : { data: [{ email: 'news@example.com', name: 'Example' }], error: null }
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'limit', 'in', 'gte', 'order']) chain[m] = () => chain
      chain.single = async () => result
      chain.then = (resolve: (v: unknown) => unknown) => resolve(result)
      return chain
    },
  }),
}))

vi.mock('@/lib/embeddings/backfill', () => ({ backfillMissingEmbeddings: vi.fn() }))

import { runNewsletterFetch } from '@/lib/newsletter/fetcher'

describe('runNewsletterFetch bei ungueltigem Gmail-Token', () => {
  beforeEach(() => {
    getProfile.mockReset()
    fetchEmailsFromSenders.mockReset()
  })

  it('meldet einen Fehler statt eines leeren Erfolgs', async () => {
    getProfile.mockRejectedValue(new Error('invalid_grant'))

    const result = await runNewsletterFetch()

    expect(result.success).toBe(false)
    expect(result.errors).toBeGreaterThan(0)
  })

  it('fragt bei ungueltigem Token gar keine Mails mehr ab', async () => {
    getProfile.mockRejectedValue(new Error('invalid_grant'))

    await runNewsletterFetch()

    expect(fetchEmailsFromSenders).not.toHaveBeenCalled()
  })
})
