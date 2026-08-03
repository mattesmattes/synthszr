import Link from 'next/link'

export interface TermProductItem {
  slug: string
  canonicalName: string
}

/**
 * Arrondierender Block: Produkte aus den Synthszr Charts, die zu diesem
 * Begriff passen (LLM-Zuordnung bei Anlage, s. glossary_term_products).
 * Verlinkt auf die Chart-Produktseite, nicht ins Lexikon. Rendert null bei
 * leerer Liste — die Zuordnung wird erst von Task 14 befüllt.
 */
export function TermProducts({
  products,
  lang,
  heading,
}: {
  products: TermProductItem[]
  lang: string
  heading: string
}) {
  if (products.length === 0) return null

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-500 mb-2">{heading}</h2>
      <ul className="flex flex-wrap gap-2">
        {products.map((product) => (
          <li key={product.slug}>
            <Link
              href={`/${lang}/rankings/${product.slug}`}
              className="inline-block rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-600 transition-colors hover:border-black hover:text-black"
            >
              {product.canonicalName}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
