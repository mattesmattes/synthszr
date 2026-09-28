/**
 * resolveProduct bei belegtem Slug.
 *
 * PROD-BEFUND 2026-09-28: "duplicate key value violates unique constraint
 * products_slug_uq … Key (slug)=(microsoft-copilot)". Das Produkt mit diesem
 * Slug war inzwischen GitHub zugeordnet (canonical_key github@copilot@@), der
 * Slug blieb als permanente URL stehen. Jede neue Erwähnung von "Microsoft
 * Copilot" (microsoft@copilot@@) scheiterte am Insert — und mit ihr die ganze
 * News, dreimal, dann aussortiert. Seit Juli 281 News mit "[object Object]".
 *
 * Identität ist der canonical_key; der Slug ist nur die URL. Ein belegter Slug
 * darf deshalb kein Produkt verhindern.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  takenSlugs: new Set<string>(),
  upserts: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/embeddings/generator', () => ({ generateEmbedding: vi.fn(async () => [] as number[]) }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: any = {}
      chain.select = vi.fn(() => chain)
      chain.eq = vi.fn(() => chain)
      chain.update = vi.fn(() => chain)
      chain.insert = vi.fn(async () => ({ error: null }))
      chain.upsert = vi.fn((row: Record<string, unknown>) => {
        state.upserts.push(row)
        const taken = state.takenSlugs.has(String(row.slug))
        chain.maybeSingle = vi.fn(async () => taken
          ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "products_slug_uq"' } }
          : { data: { id: `neu-${row.slug}` }, error: null })
        return chain
      })
      // Lookup nach canonical_key: kein Treffer — das Produkt gibt es unter
      // diesem Schlüssel noch nicht.
      chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
      chain.then = (res: (v: unknown) => void) => res({ data: null, error: null })
      void table
      return chain
    },
  }),
}))

beforeEach(() => {
  state.takenSlugs = new Set()
  state.upserts = []
})

describe('resolveProduct — belegter Slug', () => {
  it('legt das Produkt mit freiem Slug-Suffix an, statt die News scheitern zu lassen', async () => {
    state.takenSlugs.add('microsoft-copilot')
    const { resolveProduct } = await import('@/lib/rankings/resolve-product')
    const r = await resolveProduct({ vendor: 'Microsoft', detectedName: 'Copilot' })
    expect(r.canonicalKey).toBe('microsoft@copilot@@')
    expect(r.isNew).toBe(true)
    expect(state.upserts.map((u) => u.slug)).toEqual(['microsoft-copilot', 'microsoft-copilot-2'])
    expect(r.productId).toBe('neu-microsoft-copilot-2')
  })

  it('zählt weiter, wenn auch das Suffix belegt ist', async () => {
    state.takenSlugs.add('microsoft-copilot')
    state.takenSlugs.add('microsoft-copilot-2')
    const { resolveProduct } = await import('@/lib/rankings/resolve-product')
    const r = await resolveProduct({ vendor: 'Microsoft', detectedName: 'Copilot' })
    expect(r.productId).toBe('neu-microsoft-copilot-3')
  })

  it('nimmt den Wunsch-Slug, wenn er frei ist', async () => {
    const { resolveProduct } = await import('@/lib/rankings/resolve-product')
    const r = await resolveProduct({ vendor: 'Microsoft', detectedName: 'Copilot' })
    expect(state.upserts.map((u) => u.slug)).toEqual(['microsoft-copilot'])
    expect(r.productId).toBe('neu-microsoft-copilot')
  })
})
