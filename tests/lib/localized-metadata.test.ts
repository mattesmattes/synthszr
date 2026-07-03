import { describe, it, expect } from 'vitest'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'

describe('generateLocalizedMetadata canonical', () => {
  it('zeigt bei einer effectiveLocale außerhalb der availableLocales auf die x-default-URL (default locale)', () => {
    const metadata = generateLocalizedMetadata({
      title: 'Test',
      path: '/rankings/openai-codex',
      locale: 'cs',
      availableLocales: ['de', 'en'],
    })
    expect(metadata.alternates?.canonical).toBe('https://www.synthszr.com/de/rankings/openai-codex')
  })

  it('bleibt self-canonical, wenn die effectiveLocale in availableLocales enthalten ist', () => {
    const metadata = generateLocalizedMetadata({
      title: 'Test',
      path: '/rankings/openai-codex',
      locale: 'de',
      availableLocales: ['de', 'en'],
    })
    expect(metadata.alternates?.canonical).toBe('https://www.synthszr.com/de/rankings/openai-codex')
  })

  it('bleibt self-canonical für den Default-Fall (alle PUBLIC_LOCALES), locale en', () => {
    const metadata = generateLocalizedMetadata({
      title: 'Test',
      path: '/some-page',
      locale: 'en',
    })
    expect(metadata.alternates?.canonical).toBe('https://www.synthszr.com/en/some-page')
  })
})
