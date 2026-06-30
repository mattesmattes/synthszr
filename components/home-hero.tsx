'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { HomeSearch } from './home-search'

/**
 * Hero-Bereich der Startseite: zeigt standardmäßig den Charts-Promo-Link.
 * Auf das 'synthszr-search-open'-Event (vom "Search"-Button in der Nav) wird
 * stattdessen das Such-Formular eingeblendet.
 */
export function HomeHero({ locale }: { locale?: string }) {
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const open = () => setSearchOpen(true)
    window.addEventListener('synthszr-search-open', open)
    return () => window.removeEventListener('synthszr-search-open', open)
  }, [])

  if (searchOpen) return <HomeSearch locale={locale} />

  const href = !locale || locale === 'de' ? '/rankings' : `/${locale}/rankings`
  return (
    <div className="flex justify-center">
      <Link
        href={href}
        className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 py-2 text-sm sm:text-base hover:opacity-70 transition-opacity text-center"
      >
        <span className="font-bold tracking-tight">Neu: SYNTHSZR CHARTS</span>
        <span className="text-gray-600">— welche Produkte gerade rocken</span>
        <span className="bg-[#00FFFF] text-black rounded px-1.5 py-0.5 text-xs font-bold">Beta</span>
      </Link>
    </div>
  )
}
