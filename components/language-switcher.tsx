import type { LanguageCode } from '@/lib/types'
import type { ActiveLanguage } from '@/lib/i18n/active-languages'
import { getActiveLanguages } from '@/lib/i18n/active-languages'
import { LanguageSwitcherClient } from './language-switcher-client'

interface LanguageSwitcherProps {
  currentLocale: LanguageCode
  languages?: ActiveLanguage[]
}

/**
 * Server-Hülle um die Sprachleiste im Footer. Gleicher Grund wie beim
 * BloomLanguageSwitcher: beide holten die Liste unabhängig voneinander aus
 * /api/languages, also zwei ungecachte Abfragen je Seitenaufruf. getActiveLanguages
 * ist mit cache() dedupliziert — jetzt läuft eine Abfrage für beide.
 *
 * Signatur und Exportname bleiben gleich, die fünf Aufrufstellen und der
 * SiteFooter bleiben unverändert.
 */
export async function LanguageSwitcher({ currentLocale, languages }: LanguageSwitcherProps) {
  const availableLanguages = languages ?? await getActiveLanguages()

  return <LanguageSwitcherClient currentLocale={currentLocale} languages={availableLanguages} />
}
