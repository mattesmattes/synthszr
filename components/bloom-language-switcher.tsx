'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Menu } from 'bloom-menu'
import type { LanguageCode, Language } from '@/lib/types'
import { addLocaleToPathname } from '@/lib/i18n/config'

interface BloomLanguageSwitcherProps {
  currentLocale: LanguageCode
}

export function BloomLanguageSwitcher({ currentLocale }: BloomLanguageSwitcherProps) {
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

  const handleLanguageSelect = (langCode: string) => {
    // Compute fresh path inside handler to avoid stale closure issues
    const newPath = addLocaleToPathname(pathname, langCode as LanguageCode)
    // Use window.location for reliable navigation
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
      <Menu.Root direction="bottom" anchor="center">
        <Menu.Container
          buttonSize={24}
          menuWidth={180}
          menuRadius={16}
          className="bg-background shadow-lg border border-border"
        >
          <Menu.Trigger className={linkStyle}>
            Switch Language
          </Menu.Trigger>
          <Menu.Content className="py-2 bg-background">
            {activeLanguages.map((lang) => (
              <Menu.Item
                key={lang.code}
                onSelect={() => handleLanguageSelect(lang.code)}
                className={`flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer transition-colors ${
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
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Container>
      </Menu.Root>
      <span className="text-muted-foreground">·</span>
      <Link href="/companies" className={linkStyle}>
        Show Companies
      </Link>
    </div>
  )
}
