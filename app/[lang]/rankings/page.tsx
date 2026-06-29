import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getRankedProducts, getActiveCategories } from '@/lib/rankings/leaderboard'

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
      className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap border transition-colors ${
        active ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600 hover:border-black'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <header className="mb-6">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Synthszr Rankings</h1>
        <p className="text-gray-600 mt-2">
          Welche AI-Produkte gerade <b>Momentum</b> haben — täglich aus tausenden Tech-News extrahiert.
        </p>
      </header>

      {/* Kategorie-Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-6 -mx-1 px-1">
        {tab(tabBase, 'Alle', !category)}
        {categories.map((c) => tab(`${tabBase}?category=${c.slug}`, c.name, category === c.slug))}
      </div>

      {products.length === 0 ? (
        <p className="text-gray-500">Noch keine Produkte in dieser Kategorie.</p>
      ) : (
        <ol className="space-y-2">
          {products.map((p) => (
            <li key={p.id}>
              <Link
                href={`/${lang}/rankings/${p.slug}`}
                className="flex items-center gap-4 rounded-xl border border-gray-200 p-4 hover:border-black transition-colors"
              >
                <div className={`w-8 text-center text-lg font-bold ${p.rank <= 3 ? 'text-black' : 'text-gray-400'}`}>
                  {p.rank}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{p.canonicalName}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {p.vendor} · {p.mentionCount} {p.mentionCount === 1 ? 'Erwähnung' : 'Erwähnungen'} · zuletzt {fmtDate(p.lastSeen)}
                  </div>
                </div>

                <div className="w-28 shrink-0">
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">Momentum</span>
                    <span className="text-sm font-bold">{p.score}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-[#CCFF00] border-r border-black/10" style={{ width: `${Math.max(3, p.score)}%` }} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}

      <footer className="mt-10 text-xs text-gray-400 border-t pt-4">
        MVP — Score = Momentum (Erwähnungs-Häufigkeit, recency-gewichtet, Halbwertszeit 14 Tage).
        Nur Produkte mit ≥2 Erwähnungen. Sentiment &amp; Features folgen.
      </footer>
    </main>
  )
}
