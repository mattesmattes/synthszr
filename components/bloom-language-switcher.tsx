'use client'

import { useEffect, useState, useRef } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import type { LanguageCode, Language } from '@/lib/types'
import { addLocaleToPathname } from '@/lib/i18n/config'

interface BloomLanguageSwitcherProps {
  currentLocale: LanguageCode
}

export function BloomLanguageSwitcher({ currentLocale }: BloomLanguageSwitcherProps) {
  const pathname = usePathname()
  const [activeLanguages, setActiveLanguages] = useState<Language[]>([])
  const [loading, setLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLanguageSelect = (langCode: string) => {
    const newPath = addLocaleToPathname(pathname, langCode as LanguageCode)
    window.location.href = newPath
  }

  const linkStyle = "font-mono text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"

  // Don't render language switcher if loading or only one language, but still show companies link
  if (loading || activeLanguages.length <= 1) {
    return (
      <div className="flex justify-center items-center gap-4 mb-6">
        <Link href="/companies" className={linkStyle}>
          Show Companies
        </Link>
      </div>
    )
  }

  return (
    <div className="flex justify-center items-center gap-4 mb-6">
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={linkStyle}
        >
          Switch Language
        </button>
        {isOpen && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 py-2 bg-background border border-border rounded-lg shadow-lg min-w-[180px] z-50">
            {activeLanguages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageSelect(lang.code)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                  lang.code === currentLocale
                    ? 'font-semibold text-foreground bg-secondary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <span className="font-mono text-xs w-8 uppercase">
                  {lang.code}
                </span>
                <span>{lang.native_name || lang.name}</span>
                {lang.code === currentLocale && (
                  <span className="ml-auto text-xs">✓</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="text-muted-foreground">·</span>
      <Link href="/companies" className={linkStyle}>
        Show Companies
      </Link>
    </div>
  )
}
