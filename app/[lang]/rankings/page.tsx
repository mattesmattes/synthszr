import Link from 'next/link'
import { Suspense } from 'react'
import { getRankedProducts, getActiveCategories } from '@/lib/rankings/leaderboard'
import { getTranslations } from '@/lib/i18n/get-translations'
import type { LanguageCode } from '@/lib/types'
import { BloomLanguageSwitcher } from '@/components/bloom-language-switcher'
import { SiteFooter } from '@/components/site-footer'
import { VendorAvatar } from '@/components/rankings/vendor-avatar'
import { MomentumChart } from '@/components/rankings/momentum-chart'
import { MultiMomentumChart } from '@/components/rankings/multi-momentum-chart'
import { PinButton, PinBar } from '@/components/rankings/pin-controls'

const MEDAL = ['🥇', '🥈', '🥉']

// force-dynamic statt ISR: die Seite lädt zur Laufzeit aus der DB (kein Build-time-
// Prerender pro Locale — sonst scheitert der Export). Konsistent mit /companies.
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ category?: string }>
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
  const { category } = await searchParams
  const [products, categories, translations] = await Promise.all([
    getRankedProducts({ limit: category ? 50 : undefined, minMentions: 2, category }),
    getActiveCategories(),
    getTranslations(lang as LanguageCode),
  ])
  const t = (key: string) => translations[key] ?? key
  const catName = (slug: string, fallback: string) => translations[`rankings.cat.${slug}`] ?? fallback

  const tabBase = `/${lang}/rankings`
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

      {/* Kategorie-Tabs — umbrechend, damit alle Pills sichtbar sind */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {tab(tabBase, t('rankings.all'), !category)}
        {categories.map((c) => tab(`${tabBase}?category=${c.slug}`, catName(c.slug, c.name), category === c.slug))}
      </div>

      {/* Vergleichs-Chart: nur bei gewählter Kategorie, Top-Produkte über der Liste */}
      {category && products.length > 0 && (
        <div className="mb-4">
          <MultiMomentumChart lang={lang} series={products.slice(0, 8).map((p) => ({ label: p.canonicalName, slug: p.slug, vendor: p.vendor, points: p.history }))} />
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
                className={`flex-1 min-w-0 flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors hover:border-black ${
                  p.rank <= 3 ? 'border-black/20 bg-gray-50' : 'border-gray-200'
                }`}
              >
                <div className="w-5 text-center text-sm font-bold shrink-0">
                  {p.rank <= 3 ? MEDAL[p.rank - 1] : <span className="text-gray-400">{p.rank}</span>}
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
