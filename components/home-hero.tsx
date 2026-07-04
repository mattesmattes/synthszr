import Link from 'next/link'

/**
 * Hero-Bereich der Startseite: Charts-Promo-Link. Die Suche öffnet global über
 * das 'synthszr-search-open'-Event → components/search-overlay.tsx (Root-Layout).
 */
export function HomeHero({ locale }: { locale?: string }) {
  // Immer locale-präfixiert — /rankings ohne Präfix kostet einen 307-Hop.
  const href = `/${locale || 'de'}/rankings`
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
