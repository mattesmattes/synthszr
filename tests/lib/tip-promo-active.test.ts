import { describe, it, expect, vi, beforeEach } from 'vitest'

const podcastPromo = {
  id: 'p1', name: 'Podcast', headline: 'HÖR REIN', body: '', link_url: '', cta_label: '',
  gradient_from: '#000', gradient_to: '#111', gradient_direction: 'to right', text_color: '#fff',
  active: true, sort_order: 0, type: 'podcast', created_at: '2026-01-01', updated_at: '2026-01-01',
}

function mockSupabase(opts: { promos: unknown[]; episode: unknown | null }) {
  return {
    from: (table: string) => {
      if (table === 'settings') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => ({ data: { value: { mode: 'constant', constantId: 'p1' } } }) }) }) }
      }
      if (table === 'tip_promos') {
        return { select: () => ({ eq: () => ({ order: () => ({ order: () => ({ data: opts.promos }) }) }) }) }
      }
      // post_podcasts
      return { select: () => ({ not: () => ({ not: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => ({ data: opts.episode }) }) }) }) }) }) }
    },
  }
}

describe('getActiveTipPromo — podcast enrichment', () => {
  beforeEach(() => vi.resetModules())

  it('enriches a podcast promo with the latest episode title + subtitle', async () => {
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => mockSupabase({ promos: [podcastPromo], episode: { episode_title: 'Ep 1', episode_subtitle: 'A subtitle', apple_episode_url: null } }),
    }))
    const { getActiveTipPromo } = await import('@/lib/tip-promos/get-active')
    const promo = await getActiveTipPromo()
    expect(promo?.type).toBe('podcast')
    expect(promo?.podcast?.episodeTitle).toBe('Ep 1')
    expect(promo?.podcast?.episodeSubtitle).toBe('A subtitle')
  })

  it('returns null for a podcast promo when no episode with metadata exists', async () => {
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => mockSupabase({ promos: [podcastPromo], episode: null }),
    }))
    const { getActiveTipPromo } = await import('@/lib/tip-promos/get-active')
    const promo = await getActiveTipPromo()
    expect(promo).toBeNull()
  })
})
