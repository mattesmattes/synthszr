import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getProductDetail } from '@/lib/rankings/product-detail'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ lang: string; slug: string }>
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
  const { slug } = await params
  const p = await getProductDetail(slug)
  if (!p) return { title: 'Produkt nicht gefunden | Synthszr Rankings' }
  return {
    title: `${p.canonicalName} — Synthszr Ranking`,
    description: `${p.canonicalName} (${p.vendor}): Momentum-Score, Belege und Erwähnungen aus der Tech-Berichterstattung.`,
  }
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { lang, slug } = await params
  const p = await getProductDetail(slug)
  if (!p) notFound()

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <Link href={`/${lang}/rankings`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-black mb-6">
        <ArrowLeft className="w-4 h-4" /> Alle Rankings
      </Link>

      <header className="mb-8">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{p.canonicalName}</h1>
          {p.rank && <span className="text-sm font-semibold px-2 py-0.5 rounded bg-black text-white">#{p.rank}</span>}
        </div>
        <p className="text-gray-500 mt-1 text-sm">
          {p.vendor}
          {p.version && <> · Version {p.version}</>}
          {p.qualifier && <> · {p.qualifier}</>}
        </p>
      </header>

      {/* Kennzahlen */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="rounded-xl border-2 border-black p-4 bg-[#CCFF00]/20">
          <div className="text-xs uppercase tracking-wide text-gray-600">Momentum</div>
          <div className="text-3xl font-bold mt-1">{p.score ?? '—'}</div>
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Erwähnungen</div>
          <div className="text-3xl font-bold mt-1">{p.mentionCount}</div>
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Zuletzt</div>
          <div className="text-base font-semibold mt-2">{fmtDate(p.lastSeen)}</div>
        </div>
      </div>

      {/* Belege */}
      <h2 className="text-lg font-semibold mb-3">Belege ({p.mentions.length})</h2>
      <ul className="space-y-3">
        {p.mentions.map((m, i) => (
          <li key={i} className="rounded-lg border border-gray-200 p-4">
            {m.excerpt && <p className="text-sm text-gray-800">„{m.excerpt}"</p>}
            <div className="text-xs text-gray-400 mt-2">
              {m.sourceTitle ?? 'Newsletter'} · {fmtDate(m.mentionDate)}
            </div>
          </li>
        ))}
        {p.mentions.length === 0 && <li className="text-gray-500 text-sm">Keine Belege.</li>}
      </ul>

      <footer className="mt-10 text-xs text-gray-400 border-t pt-4">
        MVP — Score = Momentum (recency-gewichtete Erwähnungen). Sentiment, Features &amp; Kategorie folgen.
      </footer>
    </main>
  )
}
