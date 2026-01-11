'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Menu } from 'bloom-menu'
import Image from 'next/image'
import type { LanguageCode, Language } from '@/lib/types'
import { removeLocaleFromPathname } from '@/lib/i18n/config'

interface BloomLanguageSwitcherProps {
  currentLocale: LanguageCode
}

export function BloomLanguageSwitcher({ currentLocale }: BloomLanguageSwitcherProps) {
  const pathname = usePathname()
  const router = useRouter()
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

  const pathWithoutLocale = removeLocaleFromPathname(pathname)

  const handleLanguageSelect = (langCode: string) => {
    const newPath = `/${langCode}${pathWithoutLocale === '/' ? '' : pathWithoutLocale}`
    router.push(newPath)
  }

  // Don't render if loading or only one language
  if (loading || activeLanguages.length <= 1) {
    return (
      <div className="flex justify-center mb-6">
        <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center">
          <Image
            src="/oh-so-icon.svg"
            alt="OH-SO"
            width={28}
            height={28}
            className="invert dark:invert-0"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-center mb-6">
      <Menu.Root direction="bottom" anchor="center">
        <Menu.Container
          buttonSize={40}
          menuWidth={180}
          menuRadius={16}
          className="bg-background shadow-lg border border-border"
        >
          <Menu.Trigger className="flex items-center justify-center w-full h-full rounded-full bg-foreground hover:bg-foreground/90 transition-colors cursor-pointer ring-1 ring-black/5 dark:ring-white/10">
            <Image
              src="/oh-so-icon.svg"
              alt="OH-SO"
              width={28}
              height={28}
              className="invert dark:invert-0"
            />
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
    </div>
  )
}
