import type { LanguageCode } from '@/lib/types'

/** All potentially supported locales (must match database) */
export const ALL_LOCALES: LanguageCode[] = ['de', 'en', 'fr', 'es', 'it', 'pt', 'nl', 'pl']

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
}
