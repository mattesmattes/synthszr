'use client'

import { useEffect, useState, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import type { LanguageCode, Language } from '@/lib/types'
import { addLocaleToPathname } from '@/lib/i18n/config'

interface BloomLanguageSwitcherProps {
  currentLocale: LanguageCode
}

export function BloomLanguageSwitcher({ currentLocale }: BloomLanguageSwitcherProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [activeLanguages, setActiveLanguages] = useState<Language[]>([])
  const [loading, setLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-open + scroll into view when arriving from newsletter "Sprache ändern" link.
  // We read from window.location as a belt-and-braces fallback — useSearchParams()
  // can lag behind the initial URL on some route transitions.
  useEffect(() => {
    if (loading || activeLanguages.length <= 1) return
    const fromHook = searchParams.get('openLangSwitch') === '1'
    const fromUrl = typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('openLangSwitch') === '1'
    if (!fromHook && !fromUrl) return
    // Defer one tick so the container ref is guaranteed attached after the
    // language-fetch re-render.
    const t = setTimeout(() => {
      setIsOpen(true)
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
    return () => clearTimeout(t)
  }, [searchParams, loading, activeLanguages.length])

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

  const handleLanguageSelect = async (langCode: string) => {
    setIsOpen(false)

    // If the user arrived from the newsletter "Sprache ändern" link,
    // persist the choice to their subscriber profile before redirecting.
    const sid = searchParams.get('sid')
    if (sid) {
      try {
        await fetch('/api/newsletter/set-language', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sid, language: langCode }),
        })
      } catch (error) {
        console.error('Failed to save subscriber language preference:', error)
      }
    }

    const newPath = addLocaleToPathname(pathname, langCode as LanguageCode)
    window.location.href = newPath
  }

  const linkStyle = "font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"

  // Don't render language switcher if loading or only one language, but still show companies link
  if (loading || activeLanguages.length <= 1) {
    return (
      <div className="flex justify-center items-baseline gap-4 mb-6">
        <span className={`${linkStyle} opacity-50`}>Switch Language</span>
        <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 self-center">
          <Image src="/oh-so-icon.svg" alt="OH-SO" width={32} height={32} />
        </div>
        <Link href={currentLocale === 'de' ? '/companies' : `/${currentLocale}/companies`} className={linkStyle}>
          Show Companies
        </Link>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex justify-center items-baseline gap-4 mb-6">
      {/* Switch Language dropdown */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`${linkStyle} cursor-pointer`}
        >
          Switch Language
        </button>
        {isOpen && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 py-2 bg-background border border-border rounded-2xl shadow-lg min-w-[180px] z-50">
            {activeLanguages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageSelect(lang.code)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer transition-colors text-left ${
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

      {/* OH-SO Logo in the middle */}
      <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 self-center">
        <Image src="/oh-so-icon.svg" alt="OH-SO" width={32} height={32} />
      </div>

      {/* Show Companies link */}
      <Link href={currentLocale === 'de' ? '/companies' : `/${currentLocale}/companies`} className={linkStyle}>
        Show Companies
      </Link>
    </div>
  )
}
