import Link from 'next/link'
import { Suspense } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import { getProductDetail } from '@/lib/rankings/product-detail'
import { getTranslations } from '@/lib/i18n/get-translations'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import type { LanguageCode } from '@/lib/types'
import { VendorAvatar } from '@/components/rankings/vendor-avatar'
import { BloomLanguageSwitcher } from '@/components/bloom-language-switcher'
import { SiteFooter } from '@/components/site-footer'
import { RankingsBanner } from '@/components/rankings/rankings-banner'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ slugs?: string }>
}

// Reine Tool-Seite: Pin-State liegt im localStorage, die nackte URL ist für
// Crawler leer → noindex. Der Title bleibt für Tab/History nützlich.
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params
  const locale = lang as LanguageCode
  const translations = await getTranslations(locale)
  return generateLocalizedMetadata({
    title: `${translations['rankings.compare_title'] ?? 'Produktvergleich'} — Synthszr Charts`,
    path: '/rankings/compare',
    locale,
    noIndex: true,
  })
}

export default async function ComparePage({ params, searchParams }: PageProps) {
  const { lang } = await params
  const { slugs: slugsParam } = await searchParams
  const slugs = (slugsParam ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5)
  const [productsRaw, translations] = await Promise.all([
    Promise.all(slugs.map((s) => getProductDetail(s, lang))),
    getTranslations(lang as LanguageCode),
  ])
  const products = productsRaw.filter((p): p is NonNullable<typeof p> => !!p)
  const t = (key: string) => translations[key] ?? key

  // Synonyme Dimensionen kategorieübergreifend zusammenführen: "Preis pro 1M Token"
  // (LLM-Kategorien) und "Preis" (übrige) landen in EINER Zeile statt nebeneinander.
  // DE + EN: "Preis pro 1M Token(s)" / "Price per 1M Tokens" in die Preis-/Price-Zeile falten.
  const DIM_ALIAS: Record<string, string> = {
    'Preis pro 1M Token': 'Preis', 'Preis pro 1M Tokens': 'Preis',
    'Price per 1M Tokens': 'Price', 'Price per 1M Token': 'Price',
  }
  const canonDim = (d: string) => DIM_ALIAS[d] ?? d
  // Vereinigung aller Feature-Dimensionen (Zeilen der Tabelle)
  const dims: string[] = []
  for (const p of products) for (const f of p.features) { const d = canonDim(f.dimension); if (!dims.includes(d)) dims.push(d) }

  return (
    <>
    <main className="max-w-5xl mx-auto px-4 py-10">
      <Suspense fallback={null}>
        <BloomLanguageSwitcher currentLocale={lang as LanguageCode} />
      </Suspense>
      <RankingsBanner />

      <Link href={`/${lang}/rankings`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-black mb-4">
        <ArrowLeft className="w-4 h-4" /> {t('rankings.breadcrumb_all')}
      </Link>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1">{t('rankings.compare_title')}</h1>
      <p className="text-gray-500 text-sm mb-6">{products.length} {t('rankings.compare_products')}</p>

      {products.length === 0 ? (
        <p className="text-gray-500 text-sm">{t('rankings.compare_empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left p-2 w-40 font-medium text-gray-400 align-bottom">{t('rankings.compare_feature')}</th>
                {products.map((p) => (
                  <th key={p.slug} className="text-left p-2 align-bottom min-w-[140px]">
                    <Link href={`/${lang}/rankings/${p.slug}`} className="inline-flex items-center gap-2 hover:underline">
                      <VendorAvatar vendor={p.vendor} size={24} />
                      <span className="font-bold">{p.canonicalName}</span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="p-2 text-gray-400">{t('rankings.momentum')}</td>
                {products.map((p) => <td key={p.slug} className="p-2 font-bold tabular-nums">{p.score ?? '—'}</td>)}
              </tr>
              <tr className="border-b border-gray-100">
                <td className="p-2 text-gray-400">{t('rankings.compare_vendor')}</td>
                {products.map((p) => (
                  <td key={p.slug} className="p-2">
                    <Link href={`/${lang}/companies/${p.vendor}`} className="hover:underline">{p.vendor}</Link>
                  </td>
                ))}
              </tr>
              <tr className="border-b border-gray-100">
                <td className="p-2 text-gray-400">{t('rankings.compare_release')}</td>
                {products.map((p) => <td key={p.slug} className="p-2">{p.releasedAt ?? '—'}</td>)}
              </tr>
              {dims.map((d) => (
                <tr key={d} className="border-b border-gray-100">
                  <td className="p-2 text-gray-400">{d}</td>
                  {products.map((p) => {
                    const f = p.features.find((x) => canonDim(x.dimension) === d)
                    return <td key={p.slug} className={`p-2 ${f ? 'font-medium' : 'text-gray-300'}`}>{f?.value ?? '—'}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
    <SiteFooter locale={lang} />
    </>
  )
}
