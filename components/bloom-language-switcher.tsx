'use client'

import { useEffect, useState, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
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

    // Switches the UI language only. The newsletter language lives on the
    // preferences page, reached with a scoped token from the mail footer
    // (SEC-001) - it is no longer changed from a subscriber id carried in the
    // URL or localStorage.
    const newPath = addLocaleToPathname(pathname, langCode as LanguageCode)
    window.location.href = newPath
  }

  const linkStyle = "font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"

  // Don't render language switcher if loading or only one language, but still show companies link
  if (loading || activeLanguages.length <= 1) {
    return (
      <div className="flex justify-center items-center gap-4 mb-6">
        <span className={`${linkStyle} opacity-50`}>Language</span>
        {/* Zweite Fassung desselben Headers (nur eine Sprache aktiv bzw. noch am
            Laden). Muss identisch bleiben — die beiden Zweige sind heute schon
            einmal auseinandergelaufen, deshalb hier dieselbe Wortmarke und
            dieselben Trennstriche wie unten. */}
        <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
        <Link
          href={currentLocale === 'de' ? '/' : `/${currentLocale}`}
          aria-label="Home"
          className="flex-shrink-0"
        >
          <Image src="/synthszr-logo-dark.svg" alt="synthszr" width={120} height={24} className="h-5 w-auto dark:hidden" priority />
          <Image src="/synthszr-logo.svg" alt="" width={120} height={24} className="hidden h-5 w-auto dark:block" aria-hidden />
        </Link>
        <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
        <button onClick={() => window.dispatchEvent(new Event('synthszr-search-open'))} className={`${linkStyle} cursor-pointer`}>
          Search
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex justify-center items-center gap-4 mb-6">
      {/* Switch Language dropdown */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`${linkStyle} cursor-pointer`}
        >
          Language
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

      {/* items-center am Container, NICHT items-baseline: bei baseline setzt der
          Browser die UNTERKANTE eines Bildes auf die Schriftlinie der Nachbarn.
          Die Wortmarke hat mit dem „y" eine Unterlänge, saß dadurch zu hoch und
          Text und Bild folgten zwei verschiedenen Ausrichtungssystemen. Mit
          center liegen Labels, Trennstriche und Wortmarke auf einer optischen
          Mitte. Das runde OH-SO-Icon vorher fiel damit nicht auf, weil es
          symmetrisch war und keine Unterlänge hatte. */}
      {/* Synthszr-Wortmarke in der Mitte → Home. Ersetzt das OH-SO-Icon: der
          Header trägt die Marke der Seite, nicht die der Agentur. Dasselbe Asset
          wie im Podcast-/Newsletter-Cover (public/synthszr-logo.svg), also 1:1
          dieselbe Wortmarke. Senkrechte Trennstriche gliedern die drei Elemente,
          weil die Wortmarke breiter ist als das runde Icon und sonst mit
          „Language" und „Search" verschwimmt. */}
      <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
      <Link
        href={currentLocale === 'de' ? '/' : `/${currentLocale}`}
        aria-label="Home"
        className="flex-shrink-0"
      >
        {/* Die Wortmarke in public/synthszr-logo.svg ist WEISS (fill: #fff) — sie
            ist für die dunklen Podcast-/Newsletter-Cover gemacht und war im
            hellen Header unsichtbar. synthszr-logo-dark.svg ist dieselbe Datei
            mit getauschter Füllfarbe, identische Pfade. Beide eingebunden und per
            dark: umgeschaltet, statt eine per CSS-Filter zu invertieren: die
            Marke soll in beiden Themes exakt sie selbst sein.
            Das zweite Bild trägt alt="" und aria-hidden, damit Screenreader die
            Wortmarke nicht doppelt vorlesen. */}
        <Image
          src="/synthszr-logo-dark.svg"
          alt="synthszr"
          width={120}
          height={24}
          className="h-5 w-auto dark:hidden"
          priority
        />
        <Image
          src="/synthszr-logo.svg"
          alt=""
          width={120}
          height={24}
          className="hidden h-5 w-auto dark:block"
          aria-hidden
        />
      </Link>
      <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

      {/* Search toggle */}
      <button onClick={() => window.dispatchEvent(new Event('synthszr-search-open'))} className={`${linkStyle} cursor-pointer`}>
        Search
      </button>
    </div>
  )
}
