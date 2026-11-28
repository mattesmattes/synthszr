import { describe, it, expect } from 'vitest'
import { ADMIN_NAV_GROUPS } from '@/lib/admin/nav-config'

const EXPECTED_HREFS = [
  '/admin',
  '/admin/new',
  '/admin/create-article',
  '/admin/week-wrapup',
  '/admin/ghostwriter',
  '/admin/enrich-prompts',
  '/admin/image-prompts',
  '/admin/vocabulary',
  '/admin/glossary',
  '/admin/comments',
  '/admin/agents',
  '/admin/why',
  '/admin/languages',
  '/admin/translations',
  '/admin/audio',
  '/admin/ad-promos',
  '/admin/tip-promos',
  '/admin/mattes',
  '/admin/digests',
  '/admin/curation',
  '/admin/news-queue',
  '/admin/top-sources',
  '/admin/prompts',
  '/admin/rankings',
  '/admin/premarket',
  '/admin/daily-repo',
  '/admin/newsletters',
  '/admin/subscriptions',
  '/admin/credentials',
  '/admin/subscribers',
  '/admin/newsletter-send',
  '/admin/statistics',
  '/admin/settings',
  '/docs/architecture',
  '/admin/llm-costs',
]

describe('ADMIN_NAV_GROUPS', () => {
  it('preserves all 35 navigation routes without duplicates', () => {
    const items = ADMIN_NAV_GROUPS.flatMap((g) => g.items)
    const hrefs = items.map((i) => i.href)

    expect(new Set(hrefs).size).toBe(hrefs.length)
    for (const expected of EXPECTED_HREFS) {
      expect(hrefs).toContain(expected)
    }
    expect(hrefs.length).toBe(EXPECTED_HREFS.length)
  })

  it('assigns a distinct icon to every navigation item', () => {
    const items = ADMIN_NAV_GROUPS.flatMap((g) => g.items)
    const icons = items.map((i) => i.icon)
    expect(new Set(icons).size).toBe(items.length)
  })
})
