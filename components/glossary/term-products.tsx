import Link from 'next/link'

export interface TermProductItem {
  slug: string
  canonicalName: string
  /** Rang in der primären Kategorie der Synthszr Charts, wenn bekannt. */
  catRank?: number | null
}

/**
 * Produkte aus den Synthszr Charts, die zu diesem Begriff passen
 * (LLM-Zuordnung bei Anlage, s. glossary_term_products). Verlinkt auf die
 * Chart-Produktseite, nicht ins Lexikon.
 *
 * Darstellung wie im Artikel: Produktname plus Kategorie-Rang („#12"), also
 * dieselbe Form wie components/post-product-links.tsx.
 *
 * KEINE Sparkline, obwohl der Artikel eine zeigt: die stammt dort vom
 * Client-Renderer nach der Hydration. Serverseitig bräuchte sie
 * getCategoryCappedProducts(cap, includeHistory=TRUE) — und dieser
 * history-JSONB war die Hauptursache der Supabase-Egress-Overage
 * (project_supabase_egress). Der Artikel-SSR-Pfad verzichtet aus genau diesem
 * Grund ebenfalls darauf; eine Lexikonseite mit revalidate=900 würde es über
 * alle Begriffe hinweg noch häufiger auslösen.
 *
 * `sidebar` (Desktop, linke Spalte): Textlinks untereinander, umbrechbar.
 * `block` (Mobile): dieselbe Zeilenform, nur mit mehr Raum.
 */
export function TermProducts({
  products,
  lang,
  heading,
  variant = 'block',
}: {
  products: TermProductItem[]
  lang: string
  heading: string
  variant?: 'block' | 'sidebar'
}) {
  if (products.length === 0) return null

  const isSidebar = variant === 'sidebar'

  return (
    <section>
      <h2
        className={
          isSidebar
            ? 'text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2'
            : 'text-sm font-semibold text-gray-500 mb-2'
        }
      >
        {heading}
      </h2>
      <ul className="space-y-1.5">
        {products.map((product) => (
          <li key={product.slug}>
            <Link
              href={`/${lang}/rankings/${product.slug}`}
              className="group flex items-baseline gap-1.5 text-sm leading-snug text-gray-600 transition-colors hover:text-black"
            >
              <span className="hyphens-auto break-words group-hover:underline">{product.canonicalName}</span>
              {typeof product.catRank === 'number' && (
                <span className="shrink-0 font-mono text-xs text-gray-400">#{product.catRank}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
