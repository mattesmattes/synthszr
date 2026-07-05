import Link from 'next/link'
import ReactDOM from 'react-dom'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getRankedProducts, getActiveCategories } from '@/lib/rankings/leaderboard'
import { getCategoryIntro } from '@/lib/rankings/category-intros'
import { SITE_URL, safeJsonLd } from '@/lib/seo/site'
import { CATEGORY_GROUPS, groupForCategory, groupBySlug } from '@/lib/rankings/category-groups'
import { getTranslations } from '@/lib/i18n/get-translations'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import { LOCALE_STRINGS } from '@/lib/i18n/config'
import type { LanguageCode } from '@/lib/types'
import { BloomLanguageSwitcher } from '@/components/bloom-language-switcher'
import { SiteFooter } from '@/components/site-footer'
import { VendorAvatar } from '@/components/rankings/vendor-avatar'
import { MomentumChart } from '@/components/rankings/momentum-chart'
import { MultiMomentumChart } from '@/components/rankings/multi-momentum-chart'
import { PinButton, PinBar } from '@/components/rankings/pin-controls'
import { RankingsBanner } from '@/components/rankings/rankings-banner'

// force-dynamic statt ISR: die Seite lädt zur Laufzeit aus der DB (kein Build-time-
// Prerender pro Locale — sonst scheitert der Export). Konsistent mit /companies.
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ category?: string; group?: string; sort?: string }>
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { lang } = await params
  const { category, group } = await searchParams
  const locale = lang as LanguageCode
  const [translations, categories] = await Promise.all([
    getTranslations(locale),
    getActiveCategories(),
  ])
  const t = (key: string) => translations[key] ?? key
  const nameBySlug = new Map(categories.map((c) => [c.slug, c.name]))

  // Facetten (?category/?group) sind eigenständige Ansichten: eigener Title +
  // self-canonical auf die Facetten-URL. ?sort ist eine reine Duplikat-Ansicht
  // und taucht bewusst NICHT im canonical auf.
  let path = '/rankings'
  let title = t('rankings.meta.title')
  let description = t('rankings.meta.description')
  if (category) {
    path = `/rankings?category=${category}`
    title = `${translations[`rankings.cat.${category}`] ?? nameBySlug.get(category) ?? category} — Synthszr Charts`
    // Kategorie-spezifische Meta-Description aus dem Landingpage-Intro.
    description = getCategoryIntro(category, locale)?.summary ?? description
  } else if (group) {
    path = `/rankings?group=${group}`
    title = `${translations[`rankings.group.${group}`] ?? groupBySlug(group)?.name ?? group} — Synthszr Charts`
  }

  return generateLocalizedMetadata({
    title,
    description,
    path,
    locale,
  })
}

function fmtDate(d: string | null, lang: string): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString(LOCALE_STRINGS[lang as LanguageCode] ?? 'de-DE', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}

export default async function RankingsPage({ params, searchParams }: PageProps) {
  // 98 Vendor-Logos laden von google.com/s2/favicons (301 → t1.gstatic.com) —
  // Preconnect spart DNS+TLS für beide Origins vor dem ersten Icon-Fetch.
  ReactDOM.preconnect('https://www.google.com')
  ReactDOM.preconnect('https://t1.gstatic.com')

  const { lang } = await params
  const { category, group, sort } = await searchParams

  // Aktive Meta-Gruppe: explizit per ?group, sonst aus der gewählten Kategorie abgeleitet.
  const activeGroupSlug = group ?? (category ? groupForCategory(category) : null)
  const activeGroup = activeGroupSlug ? groupBySlug(activeGroupSlug) : undefined

  const [ranked, categories, translations] = await Promise.all([
    getRankedProducts({
      // Harter Cut: max. 50 pro Kategorie (kein Aufklappen), 100 in der
      // Gesamtansicht. Long-Tail-Produktseiten bleiben über die Sitemap und
      // Related-Products-Module erreichbar.
      limit: category ? 50 : 100,
      minMentions: 2,
      category,
      categoryIn: !category && activeGroup ? activeGroup.categories : undefined,
    }),
    getActiveCategories(),
    getTranslations(lang as LanguageCode),
  ])
  // Standard: nach Momentum (rank). Optional: nach Unternehmen (vendor), dann Score.
  const products = sort === 'vendor'
    ? [...ranked].sort((a, b) => a.vendor.localeCompare(b.vendor) || b.score - a.score)
    : ranked
  // ItemList = Rich-Result-Chance für "AI Ranking"-Queries. Top 25 reicht —
  // Google braucht die Struktur, nicht die volle Liste.
  const itemListLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Synthszr Charts',
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: products.length,
    itemListElement: products.slice(0, 25).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: p.canonicalName,
      url: `${SITE_URL}/${lang}/rankings/${p.slug}`,
    })),
  }
  // Dataset-Schema: macht die Charts als zitierfähige Datenquelle für Google
  // und AI-Engines maschinenlesbar (täglich aktualisiertes, freies Ranking).
  const datasetLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Synthszr Charts',
    description: translations['rankings.meta.description'] ?? 'Tägliches Momentum-Ranking der AI-Produkte.',
    url: `${SITE_URL}/${lang}/rankings`,
    creator: { '@type': 'Organization', name: 'Synthszr', url: `${SITE_URL}/de` },
    isAccessibleForFree: true,
    keywords: ['AI products', 'AI ranking', 'LLM', 'AI tools', 'momentum'],
  }
  const t = (key: string) => translations[key] ?? key
  const catName = (slug: string, fallback: string) => translations[`rankings.cat.${slug}`] ?? fallback
  const nameBySlug = new Map(categories.map((c) => [c.slug, c.name]))
  // Kategorie-Landingpage: SEO-Fließtext statt generischem Intro.
  const catIntro = category ? getCategoryIntro(category, lang) : null

  const tabBase = `/${lang}/rankings`
  // Aktueller Filter-Kontext für die Sort-Links (Kategorie hat Vorrang vor Gruppe).
  const ctx = category ? `category=${category}` : (activeGroupSlug ? `group=${activeGroupSlug}` : '')
  // Ebene-1-Tab als Pill: aktiv = dunkler Farbton (abgesetzt vom Nav-Panel), inaktiv grau.
  const gtab = (href: string, label: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={`rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-colors ${
        active
          ? 'bg-[#00785a] text-white font-semibold'
          : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <>
    <main className="max-w-3xl mx-auto px-4 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(itemListLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(datasetLd) }}
      />
      <Suspense fallback={null}>
        <BloomLanguageSwitcher currentLocale={lang as LanguageCode} />
      </Suspense>
      <RankingsBanner />
      <header className="mb-5">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
          {category
            ? `${catName(category, nameBySlug.get(category) ?? category)} — Synthszr Charts`
            : t('rankings.h1')}
        </h1>
        {catIntro ? (
          <div className="mt-2 space-y-2 text-sm text-gray-600 leading-relaxed">
            {catIntro.intro.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-sm text-gray-600 leading-relaxed">{t('rankings.intro')}</p>
        )}
      </header>
      {/* Nav Ebene 1+2 in abgesetztem Panel. Ist eine Gruppe aktiv, werden die übrigen
          Ebene-1-Punkte ausgeblendet (nur „Alle" + aktive Gruppe bleiben); „Alle" zeigt
          wieder alles ein. Aktive Tabs sind als dunkle Pill markiert. */}
      {(() => {
        const anyActive = !!activeGroupSlug || category === 'other'
        return (
          <div className="mb-5 rounded-xl bg-[#75fbbd] p-2.5">
            <nav className="flex flex-wrap gap-1.5">
              {gtab(tabBase, t('rankings.all'), !anyActive)}
              {CATEGORY_GROUPS.filter((g) => !anyActive || activeGroupSlug === g.slug).map((g) =>
                gtab(`${tabBase}?group=${g.slug}`, translations[`rankings.group.${g.slug}`] ?? g.short, activeGroupSlug === g.slug),
              )}
              {(!anyActive || category === 'other') &&
                gtab(`${tabBase}?category=other`, catName('other', 'Sonstige'), category === 'other')}
            </nav>
            {activeGroup && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-gray-200 pt-2.5">
                {activeGroup.categories.map((slug) => (
                  <Link
                    key={slug}
                    href={`${tabBase}?category=${slug}`}
                    className={`rounded-full border px-3 py-1 text-xs whitespace-nowrap transition-colors ${
                      category === slug
                        ? 'bg-[#00785a] text-white border-[#00785a] font-medium'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:text-gray-900'
                    }`}
                  >
                    {catName(slug, nameBySlug.get(slug) ?? slug)}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* Vergleichs-Chart: bei gewählter Kategorie ODER Gruppe, Top-Produkte über der Liste */}
      {(category || activeGroup) && products.length > 0 && (
        <div className="mb-4">
          <MultiMomentumChart lang={lang} series={products.slice(0, 8).map((p) => ({ label: p.canonicalName, slug: p.slug, vendor: p.vendor, points: p.history }))} />
        </div>
      )}

      {products.length > 0 && (
        <div className="flex items-center gap-1.5 mb-2 text-xs">
          <span className="text-gray-400 mr-1">{lang === 'de' ? 'Sortieren:' : 'Sort:'}</span>
          <Link
            href={ctx ? `${tabBase}?${ctx}` : tabBase}
            className={`px-2 py-0.5 rounded-full border transition-colors ${sort !== 'vendor' ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600 hover:border-black'}`}
          >
            Momentum
          </Link>
          <Link
            href={`${tabBase}?${ctx ? `${ctx}&` : ''}sort=vendor`}
            className={`px-2 py-0.5 rounded-full border transition-colors ${sort === 'vendor' ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600 hover:border-black'}`}
          >
            {lang === 'de' ? 'Unternehmen' : 'Company'}
          </Link>
        </div>
      )}

      {products.length === 0 ? (
        <p className="text-gray-500 text-sm">{t('rankings.empty')}</p>
      ) : (
        <ol className="space-y-1">
          {products.map((p) => (
            <li key={p.id} className="flex items-center gap-1">
              <Link
                href={`/${lang}/rankings/${p.slug}`}
                className="flex-1 min-w-0 flex items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-2 transition-colors hover:border-black"
              >
                <div className="w-6 text-center text-sm font-bold shrink-0 text-gray-500 tabular-nums">
                  {p.rank}
                </div>

                <VendorAvatar vendor={p.vendor} size={30} />

                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate leading-tight">{p.canonicalName}</div>
                  <div className="text-[11px] text-gray-500 truncate leading-tight">
                    {p.vendor} · {p.mentionCount}× · {fmtDate(p.lastSeen, lang)}
                  </div>
                </div>

                <MomentumChart points={p.history} variant="spark" width={60} height={22} />
                <div className="w-8 text-right text-sm font-bold shrink-0 tabular-nums">{p.score}</div>
              </Link>
              <PinButton slug={p.slug} />
            </li>
          ))}
        </ol>
      )}

      <footer className="mt-8 text-[11px] text-gray-400 border-t pt-3">
        {t('rankings.footer')}
      </footer>
      <PinBar lang={lang} />
    </main>
    <SiteFooter locale={lang} />
    </>
  )
}
