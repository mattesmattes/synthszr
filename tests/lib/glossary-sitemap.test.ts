/**
 * Sitemap-Erweiterung (Task 7): Lexikon-Detailseiten müssen im Sitemap-Feed
 * auftauchen, aber nur für aktive SEO-Locales (de/en) — dieselbe Locale-
 * Filterung wie die übrigen Sektionen in app/sitemap.ts (activeLocales =
 * DB-aktive Sprachen ∩ FULL_CONTENT_LOCALES). getRankedProducts,
 * fetchAllCompanyMentions und categorySlugsWithIntro werden leer gemockt,
 * damit der Test nur die Glossar-Sektion prüft.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'in']) {
        chain[m] = vi.fn(() => chain)
      }
      chain.then = (resolve: (v: unknown) => void) => {
        if (table === 'languages') {
          return resolve({ data: [{ code: 'de' }, { code: 'en' }], error: null })
        }
        // generated_posts / content_translations — für diesen Test irrelevant
        return resolve({ data: [], error: null })
      }
      return chain
    },
  }),
}))

vi.mock('@/lib/glossary/terms', () => ({
  getPublishedTermList: vi.fn(async () => [
    { slug: 'inferenz', canonicalName: 'Inferenz', summary: 'Testeintrag' },
    { slug: 'mixture-of-experts', canonicalName: 'Mixture of Experts', summary: 'Testeintrag' },
  ]),
}))

vi.mock('@/lib/rankings/leaderboard', () => ({
  getRankedProducts: vi.fn(async () => []),
}))

vi.mock('@/lib/companies/mention-rows', () => ({
  fetchAllCompanyMentions: vi.fn(async () => []),
}))

vi.mock('@/lib/rankings/category-intros', () => ({
  categorySlugsWithIntro: vi.fn(() => []),
}))

describe('sitemap — Lexikon-Einträge', () => {
  it('nimmt nur de und en in die Glossar-Einträge', async () => {
    const { default: sitemap } = await import('@/app/sitemap')
    const entries = await sitemap()
    const glossary = entries.filter((e) => e.url.includes('/glossary/'))
    expect(glossary.length).toBeGreaterThan(0)
    const langs = new Set(glossary.map((e) => e.url.split('/')[3]))
    expect([...langs].sort()).toEqual(['de', 'en'])
  })

  it('erzeugt für jeden veröffentlichten Begriff einen Eintrag pro Locale', async () => {
    const { default: sitemap } = await import('@/app/sitemap')
    const entries = await sitemap()
    const glossary = entries.filter((e) => e.url.includes('/glossary/'))
    // 2 Begriffe × 2 Locales (de/en) = 4 Detail-Einträge
    expect(glossary).toHaveLength(4)
    expect(glossary.some((e) => e.url.endsWith('/de/glossary/inferenz'))).toBe(true)
    expect(glossary.some((e) => e.url.endsWith('/en/glossary/mixture-of-experts'))).toBe(true)
  })
})
