import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProductDetail } from '@/lib/rankings/product-detail'
import { Suspense } from 'react'
import { getTranslations } from '@/lib/i18n/get-translations'
import type { LanguageCode } from '@/lib/types'
import { BloomLanguageSwitcher } from '@/components/bloom-language-switcher'
import { getVendorSynthesis } from '@/lib/rankings/vendor-synthesis'
import { VendorAvatar } from '@/components/rankings/vendor-avatar'
import { SingleMomentumChart } from '@/components/rankings/single-momentum-chart'
import { PremarketSynthesisBlock } from '@/components/rankings/premarket-synthesis-block'
import { MentionList } from '@/components/rankings/mention-list'
import { PinButton, PinBar } from '@/components/rankings/pin-controls'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ lang: string; slug: string }>
}

function sentimentClass(score: number | null): string {
  if (score == null) return 'bg-gray-100 text-gray-700'
  if (score >= 0.3) return 'bg-[#CCFF00]/40 text-black'
  if (score <= -0.3) return 'bg-red-100 text-red-700'
  return 'bg-gray-100 text-gray-700'
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}

export async function generateMetadata({ params }: PageProps) {
  const { lang, slug } = await params
  const p = await getProductDetail(slug, lang)
  if (!p) return { title: 'Produkt nicht gefunden | Synthszr Rankings' }
  return {
    title: `${p.canonicalName} — Synthszr Ranking`,
    description: `${p.canonicalName} (${p.vendor}): Momentum-Score, Belege und Erwähnungen aus der Tech-Berichterstattung.`,
  }
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { lang, slug } = await params
  const p = await getProductDetail(slug, lang)
  if (!p) notFound()
  const [vendorSyn, translations] = await Promise.all([getVendorSynthesis(p.vendor), getTranslations(lang as LanguageCode)])
  const t = (key: string) => translations[key] ?? key

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <Suspense fallback={null}>
        <BloomLanguageSwitcher currentLocale={lang as LanguageCode} />
      </Suspense>
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 mb-4 flex-wrap">
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
            {p.rank && <span className="text-xs font-semibold px-2 py-0.5 rounded bg-black text-white">#{p.rank}</span>}
          </div>
          <p className="text-gray-500 text-xs mt-0.5">
            <Link href={`/${lang}/companies/${p.vendor}`} className="hover:underline">{p.vendor}</Link>
            {p.version && <> · v{p.version}</>}
            {p.qualifier && <> · {p.qualifier}</>}
            {p.releasedAt && <> · seit {p.releasedAt}</>}
            {' · '}{p.mentionCount}× · zuletzt {fmtDate(p.lastSeen)}
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

      <footer className="mt-10 text-xs text-gray-400 border-t pt-4">
        {t('rankings.footer_product')}
      </footer>
      <PinBar lang={lang} />
    </main>
  )
}
