import type { LanguageCode } from '@/lib/types'

/** All potentially supported locales (must match database) */
export const ALL_LOCALES: LanguageCode[] = ['de', 'en', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'nds']

/**
 * Locales with real content — exposed in hreflang, sitemap, and language switcher.
 * Everything in ALL_LOCALES but not in PUBLIC_LOCALES currently 301-redirects to /de,
 * so advertising them in hreflang tells Google "reciprocal link missing" and gets
 * the whole cluster ignored.
 */
export const PUBLIC_LOCALES: LanguageCode[] = ['de', 'en', 'cs', 'nds', 'fr']

/**
 * Locales exposed to search engines (sitemap + hreflang + self-canonical).
 * de/en are the actively maintained languages. cs/nds/fr stay reachable for
 * users (language switcher, geo detection), but are excluded from sitemap and
 * hreflang and canonicalize to /de — GSC showed Google ignoring them as thin
 * duplicates ("Crawled/Discovered – currently not indexed") anyway, and the
 * conflicting signals (hreflang + cross-locale canonical) hurt the whole cluster.
 */
export const SEO_LOCALES: LanguageCode[] = ['de', 'en']

/** Default locale (fallback) */
export const DEFAULT_LOCALE: LanguageCode = 'de'

/** Locale detection from URL pathname */
export function getLocaleFromPathname(pathname: string): LanguageCode | null {
  const segments = pathname.split('/')
  const potentialLocale = segments[1] as LanguageCode

  if (ALL_LOCALES.includes(potentialLocale)) {
    return potentialLocale
  }

  return null
}

/** Remove locale prefix from pathname */
export function removeLocaleFromPathname(pathname: string): string {
  const locale = getLocaleFromPathname(pathname)
  if (locale) {
    return pathname.replace(`/${locale}`, '') || '/'
  }
  return pathname
}

/** Add locale prefix to pathname */
export function addLocaleToPathname(pathname: string, locale: LanguageCode): string {
  const cleanPath = removeLocaleFromPathname(pathname)
  return `/${locale}${cleanPath === '/' ? '' : cleanPath}`
}

/** Language display names */
export const LANGUAGE_NAMES: Record<LanguageCode, { name: string; native: string }> = {
  de: { name: 'German', native: 'Deutsch' },
  en: { name: 'English', native: 'English' },
  fr: { name: 'French', native: 'Français' },
  es: { name: 'Spanish', native: 'Español' },
  it: { name: 'Italian', native: 'Italiano' },
  pt: { name: 'Portuguese', native: 'Português' },
  nl: { name: 'Dutch', native: 'Nederlands' },
  pl: { name: 'Polish', native: 'Polski' },
  cs: { name: 'Czech', native: 'Čeština' },
  nds: { name: 'Low German', native: 'Plattdüütsch' },
}

/** Locale strings for toLocaleDateString() */
export const LOCALE_STRINGS: Record<LanguageCode, string> = {
  de: 'de-DE',
  en: 'en-US',
  fr: 'fr-FR',
  es: 'es-ES',
  it: 'it-IT',
  pt: 'pt-PT',
  nl: 'nl-NL',
  pl: 'pl-PL',
  cs: 'cs-CZ',
  nds: 'de-DE', // Low German falls back to German locale for weekdays
}

/**
 * Format a date with weekday for the "Update from..." display
 * Each language has its own natural pattern
 */
export function formatUpdateDate(date: string | Date, locale: LanguageCode): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const localeStr = LOCALE_STRINGS[locale]

  const weekday = d.toLocaleDateString(localeStr, { weekday: 'long' })
  const day = d.getDate().toString().padStart(2, '0')
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const year = d.getFullYear()

  // Full formatted date for languages that use it
  const fullDate = d.toLocaleDateString(localeStr, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })

  // Issue number = whole calendar days since the synthszr epoch (29 Dec 2025).
  // Computed from UTC-normalized calendar parts so it matches the displayed date
  // regardless of server timezone (the displayed day/month/year above is local).
  const SYNTHSZR_EPOCH_UTC = Date.UTC(2025, 11, 29) // month is 0-indexed → 11 = December
  const issue = Math.max(0, Math.round((Date.UTC(year, d.getMonth(), d.getDate()) - SYNTHSZR_EPOCH_UTC) / 86_400_000))
  const prefix = `synthszr #${issue}`

  switch (locale) {
    case 'de':
      return `${prefix} vom ${weekday}, den ${day}.${month}.${year}`
    case 'en':
      return `${prefix} from ${weekday}, ${fullDate}`
    case 'fr':
      return `${prefix} du ${weekday.toLowerCase()} ${fullDate}`
    case 'es':
      return `${prefix} del ${weekday.toLowerCase()}, ${fullDate}`
    case 'it':
      return `${prefix} di ${weekday.toLowerCase()} ${fullDate}`
    case 'pt':
      return `${prefix} de ${weekday.toLowerCase()}, ${fullDate}`
    case 'nl':
      return `${prefix} van ${weekday.toLowerCase()} ${fullDate}`
    case 'pl':
      return `${prefix} z ${weekday}, ${day}.${month}.${year}`
    case 'cs':
      return `${prefix} z ${weekday} ${fullDate}`
    case 'nds':
      return `${prefix} vun ${weekday}, den ${day}.${month}.${year}`
    default:
      return `${prefix} vom ${weekday}, den ${day}.${month}.${year}`
  }
}
