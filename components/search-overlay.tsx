'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { HomeSearch } from './home-search'

const KNOWN_LOCALES = ['de', 'en', 'cs', 'nds', 'fr']

/**
 * Globales Such-Overlay: hört seitenübergreifend auf das 'synthszr-search-open'-
 * Event (vom "Search"-Button im BloomLanguageSwitcher) und blendet die Suche als
 * Modal-Layer ein. Vorher lauschte nur die Homepage (home-hero) → auf /rankings &
 * anderen Seiten öffnete die Suche nicht. Im Root-Layout gemountet = überall aktiv.
 */
export function SearchOverlay() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const openFn = () => setOpen(true)
    window.addEventListener('synthszr-search-open', openFn)
    return () => window.removeEventListener('synthszr-search-open', openFn)
  }, [])

  // Bei Navigation schließen.
  useEffect(() => { setOpen(false) }, [pathname])

  // Escape schließt.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const seg = pathname.split('/')[1] || 'de'
  const locale = KNOWN_LOCALES.includes(seg) ? seg : 'de'

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-start justify-center px-4 pt-[8vh] overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div className="relative w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Suche schließen"
          className="absolute -top-1 right-0 -translate-y-full text-white/80 hover:text-white flex items-center gap-1 text-xs font-mono"
        >
          <X className="h-4 w-4" /> ESC
        </button>
        <div className="rounded-2xl bg-background p-4 shadow-2xl">
          <HomeSearch locale={locale} autoFocus />
        </div>
      </div>
    </div>
  )
}
