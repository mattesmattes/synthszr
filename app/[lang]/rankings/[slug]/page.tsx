import Link from 'next/link'
import ReactDOM from 'react-dom'
import { notFound } from 'next/navigation'
import { getProductDetail } from '@/lib/rankings/product-detail'
import { Suspense } from 'react'
import { getTranslations } from '@/lib/i18n/get-translations'
import type { LanguageCode } from '@/lib/types'
import { BloomLanguageSwitcher } from '@/components/bloom-language-switcher'
import { SiteFooter } from '@/components/site-footer'
import { getVendorSynthesis } from '@/lib/rankings/vendor-synthesis'
import { VendorAvatar } from '@/components/rankings/vendor-avatar'
import { SingleMomentumChart } from '@/components/rankings/single-momentum-chart'
import { PremarketSynthesisBlock } from '@/components/rankings/premarket-synthesis-block'
import { RelatedProducts } from '@/components/rankings/related-products'
import { MentionList } from '@/components/rankings/mention-list'
import { PinButton, PinBar } from '@/components/rankings/pin-controls'
import { RankingsBanner } from '@/components/rankings/rankings-banner'
import type { Metadata } from 'next'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import { LOCALE_STRINGS } from '@/lib/i18n/config'
import { SITE_URL } from '@/lib/seo/site'

// ISR statt force-dynamic: Daten ändern sich nur per täglichem Cron. Kein
// generateStaticParams → kein Build-time-Prerender (das war der Grund für das
// alte force-dynamic), Seiten rendern on-demand und cachen 5 min am Edge.
// Bei ~5000 Produktseiten ist das der Unterschied zwischen crawlbar und nicht.
export const revalidate = 300

interface PageProps {
  params: Promise<{ lang: string; slug: string }>
}

function sentimentClass(score: number | null): string {
  if (score == null) return 'bg-gray-100 text-gray-700'
  if (score >= 0.3) return 'bg-[#CCFF00]/40 text-black'
  if (score <= -0.3) return 'bg-red-100 text-red-700'
  return 'bg-gray-100 text-gray-700'
}

function fmtDate(d: string | null, lang: string): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString(LOCALE_STRINGS[lang as LanguageCode] ?? 'de-DE', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, slug } = await params
  const locale = lang as LanguageCode
  const p = await getProductDetail(slug, lang)
  if (!p) return { title: 'Produkt nicht gefunden | Synthszr Charts', robots: { index: false, follow: false } }

  const description = locale === 'de'
    ? `${p.canonicalName} (${p.vendor}): Momentum-Score, Belege und Erwähnungen aus der Tech-Berichterstattung — täglich aktualisiert in den Synthszr Charts.`
    : `${p.canonicalName} (${p.vendor}): momentum score, evidence and mentions from tech coverage — updated daily in the Synthszr Charts.`

  return generateLocalizedMetadata({
    title: locale === 'de'
      ? `${p.canonicalName} — AI-Produkt-Ranking | Synthszr Charts`
      : `${p.canonicalName} — AI Product Ranking | Synthszr Charts`,
    description,
    path: `/rankings/${slug}`,
    locale,
    // Produkt-Content existiert nur de/en — cs/fr/nds zeigen EN-Fallback und
    // gehören nicht in den hreflang-Cluster (sonst Thin-Duplicate-Signale).
    availableLocales: ['de', 'en'],
  })
}

export default async function ProductDetailPage({ params }: PageProps) {
  // 98 Vendor-Logos laden von google.com/s2/favicons (301 → t1.gstatic.com) —
  // Preconnect spart DNS+TLS für beide Origins vor dem ersten Icon-Fetch.
  ReactDOM.preconnect('https://www.google.com')
  ReactDOM.preconnect('https://t1.gstatic.com')

  const { lang, slug } = await params
  const p = await getProductDetail(slug, lang)
  if (!p) notFound()
  const [vendorSyn, translations] = await Promise.all([getVendorSynthesis(p.vendor), getTranslations(lang as LanguageCode)])
  const t = (key: string) => translations[key] ?? key

  // Kein aggregateRating/offers: Momentum-Score ist kein Review — erfundene
  // Rating-Markups riskieren Manual Actions.
  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: p.canonicalName,
    url: `${SITE_URL}/${lang}/rankings/${p.slug}`,
    ...(p.description ? { description: p.description } : {}),
    ...(p.category ? { applicationCategory: p.category.name } : {}),
    publisher: { '@type': 'Organization', name: p.vendor },
  }
  const crumbs = [
    { '@type': 'ListItem', position: 1, name: 'Synthszr', item: `${SITE_URL}/${lang}` },
    { '@type': 'ListItem', position: 2, name: 'Synthszr Charts', item: `${SITE_URL}/${lang}/rankings` },
    ...(p.category
      ? [{ '@type': 'ListItem', position: 3, name: p.category.name, item: `${SITE_URL}/${lang}/rankings?category=${p.category.slug}` }]
      : []),
  ]
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [...crumbs, { '@type': 'ListItem', position: crumbs.length + 1, name: p.canonicalName }],
  }

  return (
    <>
    <main className="max-w-3xl mx-auto px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <Suspense fallback={null}>
        <BloomLanguageSwitcher currentLocale={lang as LanguageCode} />
      </Suspense>
      <RankingsBanner />
      <nav className="flex items-center gap-1.5 text-sm text-gray-600 mb-8 flex-wrap rounded-xl bg-[#75fbbd] px-3 py-2">
        <Link href={`/${lang}/rankings`} className="hover:text-black">{t('rankings.breadcrumb_all')}</Link>
        {p.category && (
          <>
            <span className="text-gray-300">›</span>
            <Link href={`/${lang}/rankings?category=${p.category.slug}`} className="hover:text-black">{translations[`rankings.cat.${p.category.slug}`] ?? p.category.name}</Link>
          </>
        )}
        <span className="text-gray-300">›</span>
        <span className="text-gray-800 font-medium truncate">{p.canonicalName}</span>
      </nav>

      <header className="mb-4 flex items-start gap-3">
        <VendorAvatar vendor={p.vendor} size={44} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{p.canonicalName}</h1>
            {p.rank && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#00785a] text-white whitespace-nowrap">
                #{p.rank}
                {p.category && <> {t('rankings.rank_in')} {translations[`rankings.cat.${p.category.slug}`] ?? p.category.name}</>}
              </span>
            )}
          </div>
          <p className="text-gray-500 text-xs mt-0.5">
            <Link href={`/${lang}/companies/${p.vendor}`} className="hover:underline">{p.vendor}</Link>
            {p.version && <> · v{p.version}</>}
            {p.qualifier && <> · {p.qualifier}</>}
            {p.releasedAt && <> · {t('rankings.since')} {p.releasedAt}</>}
            {' · '}{p.mentionCount}× · {t('rankings.last_seen')} {fmtDate(p.lastSeen, lang)}
          </p>
        </div>
        <div className="ml-auto shrink-0 flex items-start gap-2">
          <PinButton slug={p.slug} />
          <div className="text-right">
            <div className="text-3xl font-bold leading-none tabular-nums">{p.score ?? '—'}</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400">{t('rankings.momentum')}</div>
          </div>
        </div>
      </header>

      {/* Produktbeschreibung (aus Web-Research) */}
      {p.description && (
        <p className="text-[15px] text-gray-800 leading-relaxed mb-6">{p.description}</p>
      )}

      {/* Momentum-Verlauf */}
      <div className="rounded-xl border border-gray-200 p-3 mb-6">
        <SingleMomentumChart points={p.history} height={120} />
      </div>

      {/* Sentiment */}
      {p.sentiment && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-2">Tonalität</h2>
          <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${sentimentClass(p.sentiment.score)}`}>
            {p.sentiment.label}
            {p.sentiment.score != null && <span className="opacity-70"> · {p.sentiment.score > 0 ? '+' : ''}{p.sentiment.score.toFixed(2)}</span>}
          </span>
        </div>
      )}

      {/* Features */}
      {p.features.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">{t('rankings.features')}</h2>
          <table className="w-full border border-gray-200 rounded-xl overflow-hidden text-sm">
            <tbody>
              {p.features.map((f, i) => (
                <tr key={i} className={i % 2 ? 'bg-gray-50/60' : ''}>
                  <td className="w-48 align-top px-3 py-2 text-gray-500 border-r border-gray-100">{f.dimension}</td>
                  <td className="px-3 py-2 font-medium">{f.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Belege */}
      <h2 className="text-lg font-semibold mb-3">{t('rankings.evidence')} ({p.mentions.length})</h2>
      <MentionList mentions={p.mentions} />

      {vendorSyn && <PremarketSynthesisBlock company={vendorSyn.company} synthesis={vendorSyn.synthesis} />}

      {p.category && (
        <RelatedProducts
          lang={lang}
          categorySlug={p.category.slug}
          categoryName={translations[`rankings.cat.${p.category.slug}`] ?? p.category.name}
          excludeSlug={p.slug}
          heading={t('rankings.related')}
        />
      )}

      <footer className="mt-10 text-xs text-gray-400 border-t pt-4">
        {t('rankings.footer_product')}
      </footer>
      <PinBar lang={lang} />
    </main>
    <SiteFooter locale={lang} />
    </>
  )
}
