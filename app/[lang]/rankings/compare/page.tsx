import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getProductDetail } from '@/lib/rankings/product-detail'
import { VendorAvatar } from '@/components/rankings/vendor-avatar'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ slugs?: string }>
}

export const metadata = { title: 'Vergleich — Synthszr Rankings' }

export default async function ComparePage({ params, searchParams }: PageProps) {
  const { lang } = await params
  const { slugs: slugsParam } = await searchParams
  const slugs = (slugsParam ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5)
  const products = (await Promise.all(slugs.map((s) => getProductDetail(s)))).filter((p): p is NonNullable<typeof p> => !!p)

  // Vereinigung aller Feature-Dimensionen (Zeilen der Tabelle)
  const dims: string[] = []
  for (const p of products) for (const f of p.features) if (!dims.includes(f.dimension)) dims.push(f.dimension)

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <Link href={`/${lang}/rankings`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-black mb-4">
        <ArrowLeft className="w-4 h-4" /> Alle Rankings
      </Link>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1">Produktvergleich</h1>
      <p className="text-gray-500 text-sm mb-6">{products.length} Produkte</p>

      {products.length === 0 ? (
        <p className="text-gray-500 text-sm">Keine Produkte gepinnt. Pinne Produkte über das Pin-Symbol im Ranking.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left p-2 w-40 font-medium text-gray-400 align-bottom">Feature</th>
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
                <td className="p-2 text-gray-400">Momentum</td>
                {products.map((p) => <td key={p.slug} className="p-2 font-bold tabular-nums">{p.score ?? '—'}</td>)}
              </tr>
              <tr className="border-b border-gray-100">
                <td className="p-2 text-gray-400">Hersteller</td>
                {products.map((p) => <td key={p.slug} className="p-2">{p.vendor}</td>)}
              </tr>
              <tr className="border-b border-gray-100">
                <td className="p-2 text-gray-400">Release</td>
                {products.map((p) => <td key={p.slug} className="p-2">{p.releasedAt ?? '—'}</td>)}
              </tr>
              {dims.map((d) => (
                <tr key={d} className="border-b border-gray-100">
                  <td className="p-2 text-gray-400">{d}</td>
                  {products.map((p) => {
                    const f = p.features.find((x) => x.dimension === d)
                    return <td key={p.slug} className={`p-2 ${f ? 'font-medium' : 'text-gray-300'}`}>{f?.value ?? '—'}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
