/**
 * Datencache für Ranking-Detailseiten (Egress-Befund 2026-10-03).
 *
 * Ein Headless-Crawler ruft seit dem 29.09. täglich ~6.700 Ranking-Detailseiten
 * auf. Jeder Render zog 43–320 KB aus Supabase (product_mentions) plus ~57 KB
 * für „Verwandte Produkte" (ungecachtes getRankedProducts). Ein Produkt wird im
 * Schnitt 4,7-mal über bis zu fünf Sprachen aufgerufen, verteilt über ~18 h —
 * ein Cache pro URL greift deshalb nicht. Der Cache gilt pro Produkt und
 * Sprachgruppe (de / alle anderen zeigen den EN-Fallback), 24 h, invalidiert
 * vom täglichen precompute-metrics-Cron über das Tag 'rankings'.
 *
 * Bewusst unstable_cache (Next-Datencache) statt Redis: Das Upstash-Kontingent
 * war am 28.08. schon einmal durch einen Crawler erschöpft (shared-cache.ts).
 */
import { describe, expect, it, vi } from 'vitest'

const { konfiguriert } = vi.hoisted(() => ({
  konfiguriert: [] as Array<{ keys: string[]; opts: { revalidate?: number; tags?: string[] } }>,
}))
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown, keys: string[], opts: { revalidate?: number; tags?: string[] }) => {
    konfiguriert.push({ keys, opts })
    return fn
  },
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

import { detailCacheLocale } from '@/lib/rankings/product-detail'
import '@/lib/rankings/leaderboard'

describe('detailCacheLocale', () => {
  it('trennt nur Deutsch von allen anderen Sprachen', () => {
    expect(detailCacheLocale('de')).toBe('de')
    for (const l of ['en', 'cs', 'fr', 'nds']) expect(detailCacheLocale(l)).toBe('en')
  })
})

describe('Cache-Konfiguration', () => {
  const finde = (key: string) => konfiguriert.find((k) => k.keys.includes(key))

  it('cacht die Produktdetails 24 h unter dem Tag rankings', () => {
    const c = finde('rankings-product-detail-v1')
    expect(c?.opts.revalidate).toBe(86400)
    expect(c?.opts.tags).toContain('rankings')
  })

  it('cacht die verwandten Produkte je Kategorie 24 h unter dem Tag rankings', () => {
    const c = finde('rankings-related-v1')
    expect(c?.opts.revalidate).toBe(86400)
    expect(c?.opts.tags).toContain('rankings')
  })
})
