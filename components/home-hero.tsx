import Link from 'next/link'
import type { LanguageCode } from '@/lib/types'
import { getTranslations } from '@/lib/i18n/get-translations'
import { DEFAULT_LOCALE } from '@/lib/i18n/config'

/**
 * Hero-Bereich der Startseite: Charts-Promo-Link. Die Suche öffnet global über
 * das 'synthszr-search-open'-Event → components/search-overlay.tsx (Root-Layout).
 * Async Server Component: lädt die Teaser-Texte lokalisiert (getTranslations),
 * damit "Neu: SYNTHSZR CHARTS — welche Produkte gerade rocken" in der Zielsprache
 * erscheint. "SYNTHSZR CHARTS" bleibt Eigenname, "Beta" ist in allen Sprachen gleich.
 */
export async function HomeHero({ locale }: { locale?: string }) {
  const loc = (locale || DEFAULT_LOCALE) as LanguageCode
  // Immer locale-präfixiert — /rankings ohne Präfix kostet einen 307-Hop.
  const href = `/${loc}/rankings`
  const t = await getTranslations(loc)
  return (
    <div className="flex justify-center">
      <Link
        href={href}
        className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 py-2 text-sm sm:text-base hover:opacity-70 transition-opacity text-center"
      >
        <span className="font-bold tracking-tight">{t['home.charts_new']}</span>
        <span className="text-foreground/80">{t['home.charts_tagline']}</span>
        <span className="bg-[#00FFFF] text-black rounded px-1.5 py-0.5 text-xs font-bold">Beta</span>
      </Link>
    </div>
  )
}
