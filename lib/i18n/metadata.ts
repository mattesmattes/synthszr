import type { Metadata } from 'next'
import type { LanguageCode } from '@/lib/types'
import { ALL_LOCALES, DEFAULT_LOCALE } from './config'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://synthszr.com'

interface LocalizedMetadataOptions {
  title: string
  description?: string
  path: string  // Path without locale prefix, e.g., '/posts/my-article'
  availableLocales?: LanguageCode[]  // Which locales have translations
  noIndex?: boolean
}

/**
 * Generates metadata with hreflang alternates for SEO
 */
export function generateLocalizedMetadata({
  title,
  description,
  path,
  availableLocales = ALL_LOCALES,
  noIndex = false,
}: LocalizedMetadataOptions): Metadata {
  const cleanPath = path === '/' ? '' : path

  // Build language alternates
  const languages: Record<string, string> = {}

  for (const locale of availableLocales) {
    languages[locale] = `${BASE_URL}/${locale}${cleanPath}`
  }

  // x-default points to the default locale
  languages['x-default'] = `${BASE_URL}/${DEFAULT_LOCALE}${cleanPath}`

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/${DEFAULT_LOCALE}${cleanPath}`,
      languages,
    },
    ...(noIndex && {
      robots: {
        index: false,
        follow: false,
      },
    }),
  }
}

/**
 * Gets the canonical URL for a page
 */
export function getCanonicalUrl(locale: LanguageCode, path: string): string {
  const cleanPath = path === '/' ? '' : path
  return `${BASE_URL}/${locale}${cleanPath}`
}

/**
 * Generates OpenGraph metadata with locale
 */
export function generateOGMetadata(
  locale: LanguageCode,
  title: string,
  description?: string,
  imagePath?: string
) {
  return {
    title,
    description,
    locale: locale === 'de' ? 'de_DE' : locale === 'en' ? 'en_US' : `${locale}_${locale.toUpperCase()}`,
    type: 'website',
    ...(imagePath && {
      images: [
        {
          url: `${BASE_URL}${imagePath}`,
          width: 1200,
          height: 630,
        },
      ],
    }),
  }
}
