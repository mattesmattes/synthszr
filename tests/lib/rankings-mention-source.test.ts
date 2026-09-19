/**
 * Quellen-Volltext der Produktseite erst auf Klick (Egress-Befund 2026-09-19).
 *
 * Vorher zog getProductDetail zu jeder der bis zu 60 Erwähnungen den ganzen
 * Newsletter (daily_repo.content) — im Schnitt 41 von 65 KB je Render, nur
 * für einen Dialog, den kaum jemand öffnet. Jetzt lädt getMentionSourceText
 * den Text einzeln nach.
 *
 * Der Loader ist öffentlich erreichbar (Route /api/rankings/mention-source),
 * daher ist der Sichtbarkeits-Filter der wichtigste Test: ohne ihn gäbe die
 * Route den Newsletter-Volltext hinter JEDER Erwähnung heraus, auch hinter
 * ausgeblendeten Produkten — mehr als die Produktseite je zeigte.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  chains: {} as Record<string, any[]>,
}))

function makeChain(table: string) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range']) chain[m] = vi.fn(() => chain)
  const own = state.queues[table]?.shift() ?? { data: null, error: null }
  chain.maybeSingle = vi.fn(async () => own)
  chain.then = (res: (v: unknown) => void) => res(own)
  ;(state.chains[table] ??= []).push(chain)
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: vi.fn((table: string) => makeChain(table)) }),
}))
// Nie echtes Redis aus einem Test ansprechen (.env.local zeigt auf Produktion).
vi.mock('@/lib/rankings/leaderboard', () => ({
  getRankedProductsShared: vi.fn(async () => []),
}))

import { getMentionSourceText, getProductDetail } from '@/lib/rankings/product-detail'

beforeEach(() => {
  state.queues = {}
  state.chains = {}
})

describe('getProductDetail', () => {
  it('lädt zu den Erwähnungen KEINEN Newsletter-Volltext mehr', async () => {
    state.queues.products = [{ data: { id: 'p1', canonical_name: 'X', vendor_namespace: 'v', slug: 'x' }, error: null }]
    state.queues.product_mentions = [
      { data: [{ id: 'm1', excerpt: 'e', mention_date: '2026-09-01', sentiment: null, daily_repo: { title: 'T', source_email: null, source_url: null } }], error: null },
      { data: [], error: null },
    ]
    const p = await getProductDetail('x')

    const select = state.chains.product_mentions[0].select.mock.calls[0][0] as string
    expect(select).not.toMatch(/content/)
    expect(p?.mentions[0]).toMatchObject({ id: 'm1', sourceTitle: 'T' })
    expect(p?.mentions[0]).not.toHaveProperty('sourceContent')
  })
})

describe('getMentionSourceText', () => {
  it('liefert nur Erwähnungen sichtbarer Produkte', async () => {
    state.queues.product_mentions = [{ data: { daily_repo: { content: '<p>Hallo</p>' } }, error: null }]
    await getMentionSourceText('m1')
    const chain = state.chains.product_mentions[0]
    expect(chain.eq).toHaveBeenCalledWith('id', 'm1')
    expect(chain.eq).toHaveBeenCalledWith('products.visibility_status', 'visible')
    expect(chain.select.mock.calls[0][0]).toMatch(/products!inner/)
  })

  it('gibt undefined zurück, wenn es die Erwähnung (sichtbar) nicht gibt', async () => {
    state.queues.product_mentions = [{ data: null, error: null }]
    expect(await getMentionSourceText('m1')).toBeUndefined()
  })

  it('wandelt HTML in Text und kappt bei 6000 Zeichen', async () => {
    const long = '<p>' + 'a'.repeat(7000) + '</p>'
    state.queues.product_mentions = [{ data: { daily_repo: { content: long } }, error: null }]
    const text = await getMentionSourceText('m1')
    expect(text).toHaveLength(6000)
    expect(text).not.toContain('<p>')
  })

  it('gibt null zurück, wenn die Quelle keinen Text hat', async () => {
    state.queues.product_mentions = [{ data: { daily_repo: { content: null } }, error: null }]
    expect(await getMentionSourceText('m1')).toBeNull()
  })

  it('wirft bei DB-Fehlern statt still "kein Volltext" zu melden', async () => {
    state.queues.product_mentions = [{ data: null, error: { message: 'boom' } }]
    await expect(getMentionSourceText('m1')).rejects.toThrow(/boom/)
  })
})
