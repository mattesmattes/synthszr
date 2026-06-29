'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Pin, X } from 'lucide-react'

const KEY = 'synthszr_pins'
const MAX = 5

function readPins(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}
function writePins(p: string[]) {
  localStorage.setItem(KEY, JSON.stringify(p))
  window.dispatchEvent(new Event('synthszr-pins'))
}

function usePins(): string[] {
  const [pins, setPins] = useState<string[]>([])
  useEffect(() => {
    const sync = () => setPins(readPins())
    sync()
    window.addEventListener('synthszr-pins', sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener('synthszr-pins', sync); window.removeEventListener('storage', sync) }
  }, [])
  return pins
}

export function PinButton({ slug }: { slug: string }) {
  const pins = usePins()
  const pinned = pins.includes(slug)
  const toggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const p = readPins()
    writePins(pinned ? p.filter((x) => x !== slug) : [...p, slug].slice(0, MAX))
  }
  return (
    <button
      onClick={toggle}
      title={pinned ? 'Aus Vergleich entfernen' : 'Zum Vergleich pinnen'}
      aria-label="Pinnen"
      className={`shrink-0 rounded-md p-1 transition-colors ${pinned ? 'text-black' : 'text-gray-300 hover:text-gray-600'}`}
    >
      <Pin className="w-4 h-4" fill={pinned ? 'currentColor' : 'none'} />
    </button>
  )
}

export function PinBar({ lang }: { lang: string }) {
  const pins = usePins()
  if (pins.length === 0) return null
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full bg-black text-white shadow-lg px-4 py-2 text-sm">
      <span>{pins.length} gepinnt</span>
      <Link href={`/${lang}/rankings/compare?slugs=${pins.join(',')}`} className="font-semibold bg-[#CCFF00] text-black rounded-full px-3 py-1 hover:opacity-90">
        Vergleichen
      </Link>
      <button onClick={() => writePins([])} aria-label="Pins leeren" className="text-white/70 hover:text-white">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
