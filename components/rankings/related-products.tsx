import Link from 'next/link'
import { getRankedProducts } from '@/lib/rankings/leaderboard'
import { VendorAvatar } from './vendor-avatar'

/** Server-gerendertes "Weitere Produkte in dieser Kategorie"-Modul: verlinkt
 *  Kategorie-Nachbarn im Ranking als echte <a href> — Crawl-Mesh gegen die
 *  ~3.300 Orphan-Produktseiten. */
export async function RelatedProducts({
  lang,
  categorySlug,
  categoryName,
  excludeSlug,
  heading,
}: {
  lang: string
  categorySlug: string
  categoryName: string
  excludeSlug: string
  heading: string
}) {
  let items: Awaited<ReturnType<typeof getRankedProducts>>
  try {
    items = await getRankedProducts({ category: categorySlug, limit: 13, minMentions: 2 })
  } catch {
    return null // nicht essenziell — Seite darf ohne das Modul rendern
  }
  const related = items.filter((x) => x.slug !== excludeSlug).slice(0, 12)
  if (related.length === 0) return null

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold mb-3">
        {heading}: {categoryName}
      </h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {related.map((x) => (
          <li key={x.slug}>
            <Link
              href={`/${lang}/rankings/${x.slug}`}
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm transition-colors hover:border-black"
            >
              <VendorAvatar vendor={x.vendor} size={22} />
              <span className="font-medium truncate">{x.canonicalName}</span>
              <span className="ml-auto shrink-0 tabular-nums font-bold">{x.score}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
