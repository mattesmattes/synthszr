'use client'

import Link from 'next/link'
import { useState } from 'react'

/**
 * Ebene-2-Kategorie als Pill mit 3D-Icon (Airbnb-Stil). Icon liegt unter
 * /category-icons/{slug}.png; fehlt es (noch), fällt die Pill auf ein Initial-
 * Badge zurück. Aktiv = grüner Kanon-Ton wie die Ebene-1-Gruppen-Pills.
 */
export function CategoryPill({
  href,
  slug,
  label,
  active,
}: {
  href: string
  slug: string
  label: string
  active: boolean
}) {
  const [imgOk, setImgOk] = useState(true)
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
        active
          ? 'bg-[#00785a] text-white border-[#00785a] font-medium'
          : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
      }`}
    >
      {imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/category-icons/${slug}.png`}
          alt=""
          width={22}
          height={22}
          loading="lazy"
          onError={() => setImgOk(false)}
          className="h-[22px] w-[22px] shrink-0 rounded object-contain"
        />
      ) : (
        <span
          aria-hidden
          className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-[11px] font-bold ${
            active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {label.trim().charAt(0).toUpperCase()}
        </span>
      )}
      {label}
    </Link>
  )
}
