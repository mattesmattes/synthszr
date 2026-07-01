import Link from 'next/link'
import { Suspense } from 'react'
import { getRankedProducts, getActiveCategories } from '@/lib/rankings/leaderboard'
import { CATEGORY_GROUPS, groupForCategory, groupBySlug } from '@/lib/rankings/category-groups'
import { getTranslations } from '@/lib/i18n/get-translations'
import type { LanguageCode } from '@/lib/types'
import { BloomLanguageSwitcher } from '@/components/bloom-language-switcher'
import { SiteFooter } from '@/components/site-footer'
import { VendorAvatar } from '@/components/rankings/vendor-avatar'
import { MomentumChart } from '@/components/rankings/momentum-chart'
import { MultiMomentumChart } from '@/components/rankings/multi-momentum-chart'
import { PinButton, PinBar } from '@/components/rankings/pin-controls'

// force-dynamic statt ISR: die Seite lädt zur Laufzeit aus der DB (kein Build-time-
// Prerender pro Locale — sonst scheitert der Export). Konsistent mit /companies.
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ category?: string; group?: string; sort?: string }>
}

export const metadata = {
  title: 'Synthszr Charts — welche AI-Produkte den Takt vorgeben',
  description: 'Welche AI-Produkte gerade den Takt vorgeben — täglich aus tausenden News ausgewertet.',
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}

export default async function RankingsPage({ params, searchParams }: PageProps) {
  const { lang } = await params
  const { category, group, sort } = await searchParams

  // Aktive Meta-Gruppe: explizit per ?group, sonst aus der gewählten Kategorie abgeleitet.
  const activeGroupSlug = group ?? (category ? groupForCategory(category) : null)
  const activeGroup = activeGroupSlug ? groupBySlug(activeGroupSlug) : undefined

  const [ranked, categories, translations] = await Promise.all([
    getRankedProducts({
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
  const t = (key: string) => translations[key] ?? key
  const catName = (slug: string, fallback: string) => translations[`rankings.cat.${slug}`] ?? fallback
  const groupName = (g: { slug: string; name: string }) => translations[`rankings.group.${g.slug}`] ?? g.name
  const nameBySlug = new Map(categories.map((c) => [c.slug, c.name]))

  const tabBase = `/${lang}/rankings`
  // Aktueller Filter-Kontext für die Sort-Links (Kategorie hat Vorrang vor Gruppe).
  const ctx = category ? `category=${category}` : (activeGroupSlug ? `group=${activeGroupSlug}` : '')
  const tab = (href: string, label: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap border transition-colors ${
        active ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600 hover:border-black'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <>
    <main className="max-w-3xl mx-auto px-4 py-10">
      <Suspense fallback={null}>
        <BloomLanguageSwitcher currentLocale={lang as LanguageCode} />
      </Suspense>
      <header className="mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Synthszr Charts</h1>
        <p className="text-gray-600 text-sm mt-1" dangerouslySetInnerHTML={{ __html: t('rankings.subtitle') }} />
      </header>

      {/* Zwei-Ebenen-Navigation: Meta-Gruppen (Ebene 1) → Unterkategorien (Ebene 2) */}
      <div className="mb-4">
        <nav className="flex flex-wrap gap-1.5">
          {tab(tabBase, t('rankings.all'), !category && !activeGroupSlug)}
          {CATEGORY_GROUPS.map((g) => tab(`${tabBase}?group=${g.slug}`, groupName(g), activeGroupSlug === g.slug))}
          {tab(`${tabBase}?category=other`, catName('other', 'Sonstige'), category === 'other')}
        </nav>
        {activeGroup && (
          <nav className="flex flex-wrap gap-1.5 mt-2 pl-3 border-l-2 border-gray-200">
            {tab(`${tabBase}?group=${activeGroup.slug}`, t('rankings.all'), !category)}
            {activeGroup.categories.map((slug) =>
              tab(`${tabBase}?category=${slug}`, catName(slug, nameBySlug.get(slug) ?? slug), category === slug),
            )}
          </nav>
        )}
      </div>

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
                    {p.vendor} · {p.mentionCount}× · {fmtDate(p.lastSeen)}
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
