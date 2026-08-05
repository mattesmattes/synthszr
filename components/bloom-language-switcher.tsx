import type { LanguageCode } from '@/lib/types'
import { getActiveLanguages } from '@/lib/i18n/active-languages'
import { BloomLanguageSwitcherClient } from './bloom-language-switcher-client'

interface BloomLanguageSwitcherProps {
  currentLocale: LanguageCode
}

/**
 * Server-Hülle um den interaktiven Umschalter: sie lädt die Sprachliste beim
 * Rendern, statt sie den Browser aus /api/languages nachholen zu lassen. Der
 * Client-Teil (bloom-language-switcher-client.tsx) bleibt unverändert
 * interaktiv — Dropdown, Klick-außerhalb, Suchbutton.
 *
 * Signatur und Exportname sind absichtlich dieselben wie vorher, damit die
 * zehn Aufrufstellen nicht angefasst werden müssen. Sie rendern die Komponente
 * schon in <Suspense>, was hier weiterhin passt: die Abfrage darf den Rest der
 * Seite nicht aufhalten.
 */
export async function BloomLanguageSwitcher({ currentLocale }: BloomLanguageSwitcherProps) {
  const languages = await getActiveLanguages()

  return <BloomLanguageSwitcherClient currentLocale={currentLocale} languages={languages} />
}
