import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getProductDetail } from '@/lib/rankings/product-detail'
import { getVendorSynthesis } from '@/lib/rankings/vendor-synthesis'
import { VendorAvatar } from '@/components/rankings/vendor-avatar'
import { MomentumChart } from '@/components/rankings/momentum-chart'
import { PremarketSynthesisBlock } from '@/components/rankings/premarket-synthesis-block'

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
  const vendorSyn = await getVendorSynthesis(p.vendor)

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <Link href={`/${lang}/rankings`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-black mb-4">
        <ArrowLeft className="w-4 h-4" /> Alle Rankings
      </Link>

      <header className="mb-4 flex items-start gap-3">
        <VendorAvatar vendor={p.vendor} size={44} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{p.canonicalName}</h1>
            {p.rank && <span className="text-xs font-semibold px-2 py-0.5 rounded bg-black text-white">#{p.rank}</span>}
          </div>
          <p className="text-gray-500 text-xs mt-0.5">
            {p.vendor}
            {p.version && <> · v{p.version}</>}
            {p.qualifier && <> · {p.qualifier}</>}
            {p.releasedAt && <> · seit {p.releasedAt}</>}
            {' · '}{p.mentionCount}× · zuletzt {fmtDate(p.lastSeen)}
          </p>
        </div>
        <div className="ml-auto shrink-0 text-right">
          <div className="text-3xl font-bold leading-none tabular-nums">{p.score ?? '—'}</div>
          <div className="text-[10px] uppercase tracking-wide text-gray-400">Momentum</div>
        </div>
      </header>

      {/* Produktbeschreibung (aus Web-Research) */}
      {p.description && (
        <p className="text-[15px] text-gray-800 leading-relaxed mb-6">{p.description}</p>
      )}

      {/* Momentum-Verlauf */}
      <div className="rounded-xl border border-gray-200 p-3 mb-6">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Momentum-Verlauf (21 Tage)</div>
        <MomentumChart points={p.history} variant="full" height={110} />
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
          <h2 className="text-lg font-semibold mb-3">Features</h2>
          <dl className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
            {p.features.map((f, i) => (
              <div key={i} className="flex gap-4 p-3 text-sm">
                <dt className="w-44 shrink-0 text-gray-500">{f.dimension}</dt>
                <dd className="font-medium">{f.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-gray-400 mt-2">Aus News-Belegen extrahiert — Web-Research für vollständige Specs folgt.</p>
        </div>
      )}

      {/* Belege */}
      <h2 className="text-lg font-semibold mb-3">Belege ({p.mentions.length})</h2>
      <ul className="space-y-1">
        {p.mentions.map((m, i) => (
          <li key={i} className="flex items-baseline gap-2 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm">
            <span className="text-red-600 text-xs font-semibold shrink-0 tabular-nums">{fmtDate(m.mentionDate)}</span>
            <span className="text-gray-800 truncate" title={m.excerpt ?? m.sourceTitle ?? ''}>
              {m.excerpt ? `„${m.excerpt}"` : (m.sourceTitle ?? 'Newsletter')}
            </span>
          </li>
        ))}
        {p.mentions.length === 0 && <li className="text-gray-500 text-sm">Keine Belege.</li>}
      </ul>

      {vendorSyn && <PremarketSynthesisBlock company={vendorSyn.company} synthesis={vendorSyn.synthesis} />}

      <footer className="mt-10 text-xs text-gray-400 border-t pt-4">
        MVP — Score = Momentum (recency-gewichtete Erwähnungen). Sentiment, Features &amp; Kategorie folgen.
      </footer>
    </main>
  )
}
