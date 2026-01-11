'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { LanguageCode, Language } from '@/lib/types'
import { removeLocaleFromPathname } from '@/lib/i18n/config'

interface LanguageSwitcherProps {
  currentLocale: LanguageCode
}

export function LanguageSwitcher({ currentLocale }: LanguageSwitcherProps) {
  const pathname = usePathname()
  const [activeLanguages, setActiveLanguages] = useState<Language[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchLanguages() {
      try {
        const response = await fetch('/api/languages')
        if (response.ok) {
          const data = await response.json()
          setActiveLanguages(data.languages || [])
        }
      } catch (error) {
        console.error('Error fetching languages:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchLanguages()
  }, [])

  // Remove current locale prefix from pathname
  const pathWithoutLocale = removeLocaleFromPathname(pathname)

  // Don't render if loading or only one language
  if (loading || activeLanguages.length <= 1) {
    return null
  }

  return (
    <div className="flex items-center gap-1 font-mono text-xs">
      {activeLanguages.map((lang, index) => (
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
