import type { Metadata } from 'next'
import type { LanguageCode } from '@/lib/types'
import { PUBLIC_LOCALES, DEFAULT_LOCALE } from './config'
import { SITE_URL } from '@/lib/seo/site'

const BASE_URL = SITE_URL
// Versioned filename forces LinkedIn / X / Facebook to drop their
// cached image. Bumping the suffix is the only reliable cache-buster
// because the scrapers key on the exact URL, not on Last-Modified.
const DEFAULT_OG_IMAGE = `${BASE_URL}/og-image-v2.jpg`

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
  availableLocales = PUBLIC_LOCALES,
  noIndex = false,
  locale,
  ogImage,
  ogType = 'website',
}: LocalizedMetadataOptions): Metadata {
  const cleanPath = path === '/' ? '' : path
  const effectiveLocale = locale ?? DEFAULT_LOCALE

  // Build language alternates — only include locales with real content so Google
  // can build a valid reciprocal hreflang cluster.
  const languages: Record<string, string> = {}

  for (const loc of availableLocales) {
    languages[loc] = `${BASE_URL}/${loc}${cleanPath}`
  }

  // x-default points to the default locale
  languages['x-default'] = `${BASE_URL}/${DEFAULT_LOCALE}${cleanPath}`

  const url = `${BASE_URL}/${effectiveLocale}${cleanPath}`

  // Liegt die effektive Locale außerhalb der availableLocales (z.B. cs zeigt
  // EN-Fallback-Content, ist aber nicht im hreflang-Cluster), würde ein
  // Self-Canonical eine indexierbare Thin-Duplicate-Seite außerhalb des
  // Clusters erzeugen. In dem Fall zeigt canonical auf x-default statt auf sich selbst.
  const canonicalUrl = availableLocales.includes(effectiveLocale)
    ? url
    : languages['x-default']

  const ogLocale = effectiveLocale === 'de' ? 'de_DE'
    : effectiveLocale === 'en' ? 'en_US'
    : effectiveLocale === 'cs' ? 'cs_CZ'
    : effectiveLocale === 'nds' ? 'nds_DE'
    : `${effectiveLocale}_${effectiveLocale.toUpperCase()}`

  // Fall back to the brand OG image so link previews on LinkedIn, X, etc.
  // never render a blank placeholder. Pages with their own cover override it.
  const effectiveOgImage = ogImage || DEFAULT_OG_IMAGE

  return {
    title,
    description,
    alternates: {
      // Self-referential canonical: each locale page points to itself, not the
      // default locale — otherwise Google treats non-default pages as duplicates
      // of /de and never indexes them. Exception: effectiveLocale outside
      // availableLocales (see canonicalUrl above) falls back to x-default.
      canonical: canonicalUrl,
      languages,
    },
    openGraph: {
      title,
      description: description || undefined,
      url,
      locale: ogLocale,
      type: ogType,
      siteName: 'Synthszr',
      images: [{ url: effectiveOgImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: description || undefined,
      images: [effectiveOgImage],
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

/** Bereinigt einen Roh-Excerpt für Meta-/OG-Descriptions: Bullet-Zeichen und
 *  Zeilenumbrüche raus, Whitespace kollabieren, an Wortgrenze auf ~155 Zeichen
 *  kürzen (Google schneidet sonst mitten im ersten Bullet ab). */
export function cleanMetaDescription(raw: string, maxLength = 155): string {
  // Nur Bullet-Zeichen strippen — Gedankenstriche (–/—) sind legitimer Fließtext.
  const cleaned = raw.replace(/[•·▪‣]\s*/g, '').replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  const cut = cleaned.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(' ')
  const base = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${base.replace(/[,;:.]$/, '')}…`
}
