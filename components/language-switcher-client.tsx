'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { LanguageCode } from '@/lib/types'
import type { ActiveLanguage } from '@/lib/i18n/active-languages'
import { removeLocaleFromPathname } from '@/lib/i18n/config'

interface LanguageSwitcherClientProps {
  currentLocale: LanguageCode
  /** Serverseitig geladen (s. language-switcher.tsx) — vorher holte diese
   *  Komponente die Liste selbst und gab bis zur Antwort null zurück, die
   *  Sprachleiste im Footer erschien also erst nach rund 800 ms. */
  languages: ActiveLanguage[]
}

export function LanguageSwitcherClient({ currentLocale, languages }: LanguageSwitcherClientProps) {
  const pathname = usePathname()

  // Remove current locale prefix from pathname
  const pathWithoutLocale = removeLocaleFromPathname(pathname)

  // Don't render if only one language
  if (languages.length <= 1) {
    return null
  }

  return (
    <div className="flex items-center gap-1 font-mono text-xs">
      {languages.map((lang, index) => (
        <span key={lang.code} className="flex items-center">
          {index > 0 && <span className="text-muted-foreground mx-1">|</span>}
          {lang.code === currentLocale ? (
            <span className="font-bold text-foreground">
              {lang.code.toUpperCase()}
            </span>
          ) : (
            <Link
              href={`/${lang.code}${pathWithoutLocale === '/' ? '' : pathWithoutLocale}`}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {lang.code.toUpperCase()}
            </Link>
          )}
        </span>
      ))}
    </div>
  )
}
