// tests/lib/rankings-resolve-product-db.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('@/lib/embeddings/generator', () => ({ generateEmbedding: vi.fn(async () => [] as number[]) }))

const hasDb = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL

describe.skipIf(!hasDb)('resolveProduct — Idempotenz & Vendor-Sicherheit (DB)', () => {
  const RUN = Math.abs(Date.now() % 100000).toString(36)
  const VENDOR = `zztestvendor-${RUN}`
  let supabase: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>

  beforeAll(async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    supabase = createAdminClient()
  })
  afterAll(async () => { await supabase.from('products').delete().like('vendor_namespace', `zztestvendor-${RUN}%`) })

  it('mehrfaches resolve + Schreibvariante → 1 Produkt, 1 created, 1 alias', async () => {
    const { resolveProduct } = await import('@/lib/rankings/resolve-product')
    const a = await resolveProduct({ vendor: VENDOR, detectedName: 'ZZModel 9.9' })
    const b = await resolveProduct({ vendor: VENDOR, detectedName: 'zzmodel  9.9' })
    const c = await resolveProduct({ vendor: VENDOR, detectedName: 'ZZModel 9.9' })
    expect(b.canonicalKey).toBe(a.canonicalKey); expect(c.canonicalKey).toBe(a.canonicalKey)
    expect(a.isNew).toBe(true); expect(b.isNew).toBe(false); expect(c.isNew).toBe(false)
    const { data: prods } = await supabase.from('products').select('id').eq('vendor_namespace', VENDOR)
    expect(prods).toHaveLength(1)
    const { data: ev } = await supabase.from('product_identity_events').select('id').eq('product_id', a.productId).eq('event_type', 'created')
    expect(ev).toHaveLength(1)
    const { data: al } = await supabase.from('product_aliases').select('id').eq('product_id', a.productId)
    expect(al!.length).toBeGreaterThanOrEqual(1)
  })

  it('verschiedene Versionen/Qualifier → verschiedene Produkte', async () => {
    const { resolveProduct } = await import('@/lib/rankings/resolve-product')
    const v1 = await resolveProduct({ vendor: VENDOR, detectedName: 'ZZSplit 1.0' })
    const v2 = await resolveProduct({ vendor: VENDOR, detectedName: 'ZZSplit 2.0' })
    const q = await resolveProduct({ vendor: VENDOR, detectedName: 'ZZSplit 1.0 mini' })
    expect(new Set([v1.productId, v2.productId, q.productId]).size).toBe(3)
  })

  it('gleicher Name, verschiedene Vendors → verschiedene Produkte', async () => {
    const { resolveProduct } = await import('@/lib/rankings/resolve-product')
    const a = await resolveProduct({ vendor: `${VENDOR}-a`, detectedName: 'Studio' })
    const b = await resolveProduct({ vendor: `${VENDOR}-b`, detectedName: 'Studio' })
    expect(a.canonicalKey).not.toBe(b.canonicalKey)
    expect(a.productId).not.toBe(b.productId)
  })
})
