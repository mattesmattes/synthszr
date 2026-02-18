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
  locale?: LanguageCode
  ogImage?: string             // Absolute URL to OG image
  ogType?: 'website' | 'article'
}

/**
 * Generates metadata with hreflang alternates, OG and Twitter tags for SEO
 */
export function generateLocalizedMetadata({
  title,
  description,
  path,
  availableLocales = ALL_LOCALES,
  noIndex = false,
  locale,
  ogImage,
  ogType = 'website',
}: LocalizedMetadataOptions): Metadata {
  const cleanPath = path === '/' ? '' : path

  // Build language alternates
  const languages: Record<string, string> = {}

  for (const loc of availableLocales) {
    languages[loc] = `${BASE_URL}/${loc}${cleanPath}`
  }

  // x-default points to the default locale
  languages['x-default'] = `${BASE_URL}/${DEFAULT_LOCALE}${cleanPath}`

  const url = locale
    ? `${BASE_URL}/${locale}${cleanPath}`
    : `${BASE_URL}/${DEFAULT_LOCALE}${cleanPath}`

  const ogLocale = locale
    ? (locale === 'de' ? 'de_DE' : locale === 'en' ? 'en_US' : `${locale}_${locale.toUpperCase()}`)
    : 'de_DE'

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/${DEFAULT_LOCALE}${cleanPath}`,
      languages,
    },
    openGraph: {
      title,
      description: description || undefined,
      url,
      locale: ogLocale,
      type: ogType,
      siteName: 'Synthszr',
      ...(ogImage && {
        images: [{ url: ogImage, width: 1200, height: 630 }],
      }),
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title,
      description: description || undefined,
      ...(ogImage && { images: [ogImage] }),
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
