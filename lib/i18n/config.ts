import type { LanguageCode } from '@/lib/types'

/** All potentially supported locales (must match database) */
export const ALL_LOCALES: LanguageCode[] = ['de', 'en', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'nds']

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
const LOCALE_STRINGS: Record<LanguageCode, string> = {
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

  switch (locale) {
    case 'de':
      return `Update vom ${weekday}, den ${day}.${month}.${year}`
    case 'en':
      return `Update from ${weekday}, ${fullDate}`
    case 'fr':
      return `Mise à jour du ${weekday.toLowerCase()} ${fullDate}`
    case 'es':
      return `Actualización del ${weekday.toLowerCase()}, ${fullDate}`
    case 'it':
      return `Aggiornamento di ${weekday.toLowerCase()} ${fullDate}`
    case 'pt':
      return `Atualização de ${weekday.toLowerCase()}, ${fullDate}`
    case 'nl':
      return `Update van ${weekday.toLowerCase()} ${fullDate}`
    case 'pl':
      return `Aktualizacja z ${weekday}, ${day}.${month}.${year}`
    case 'cs':
      return `Aktualizace z ${weekday} ${fullDate}`
    case 'nds':
      // Low German: use German-style formatting with Plattdüütsch prefix
      return `Updoot vun ${weekday}, den ${day}.${month}.${year}`
    default:
      return `Update vom ${weekday}, den ${day}.${month}.${year}`
  }
}
