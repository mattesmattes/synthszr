import Link from 'next/link'
import { getRankedProducts, getActiveCategories } from '@/lib/rankings/leaderboard'
import { VendorAvatar } from '@/components/rankings/vendor-avatar'
import { MomentumChart } from '@/components/rankings/momentum-chart'
import { MultiMomentumChart } from '@/components/rankings/multi-momentum-chart'

const MEDAL = ['🥇', '🥈', '🥉']

// force-dynamic statt ISR: die Seite lädt zur Laufzeit aus der DB (kein Build-time-
// Prerender pro Locale — sonst scheitert der Export). Konsistent mit /companies.
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ category?: string }>
}

export const metadata = {
  title: 'Synthszr Rankings — AI-Produkte mit Momentum',
  description: 'Welche AI-Produkte gerade in der Tech-Berichterstattung Momentum haben — täglich aus tausenden News extrahiert.',
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
  const [products, categories] = await Promise.all([
    getRankedProducts({ limit: 50, minMentions: 2, category }),
    getActiveCategories(),
  ])

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
    <main className="max-w-3xl mx-auto px-4 py-10">
      <header className="mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Synthszr Rankings</h1>
        <p className="text-gray-600 text-sm mt-1">
          Welche AI-Produkte gerade <b>Momentum</b> haben — täglich aus tausenden Tech-News.
        </p>
      </header>

      {/* Kategorie-Tabs — umbrechend, damit alle Pills sichtbar sind */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {tab(tabBase, 'Alle', !category)}
        {categories.map((c) => tab(`${tabBase}?category=${c.slug}`, c.name, category === c.slug))}
      </div>

      {/* Vergleichs-Chart: nur bei gewählter Kategorie, Top-Produkte über der Liste */}
      {category && products.length > 0 && (
        <div className="mb-4">
          <MultiMomentumChart series={products.slice(0, 8).map((p) => ({ label: p.canonicalName, points: p.history }))} />
        </div>
      )}

      {products.length === 0 ? (
        <p className="text-gray-500 text-sm">Noch keine Produkte in dieser Kategorie.</p>
      ) : (
        <ol className="space-y-1">
          {products.map((p) => (
            <li key={p.id}>
              <Link
                href={`/${lang}/rankings/${p.slug}`}
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors hover:border-black ${
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
            </li>
          ))}
        </ol>
      )}

      <footer className="mt-8 text-[11px] text-gray-400 border-t pt-3">
        Score = Momentum (Erwähnungen, recency-gewichtet, Halbwertszeit 14 Tage). Sparkline = Verlauf 21 Tage. Nur Produkte mit ≥2 Erwähnungen.
      </footer>
    </main>
  )
}
