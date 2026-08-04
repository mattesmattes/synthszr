import Link from 'next/link'
import { VendorAvatar } from '@/components/rankings/vendor-avatar'

export interface TermProductItem {
  slug: string
  canonicalName: string
  /** Vendor-Namespace für das Logo; fehlt, wenn das Produkt nicht in den Charts steht. */
  vendor?: string | null
  /** Chart-Score, rechtsbündig wie in den Rankings. */
  score?: number | null
}

/**
 * Produkte aus den Synthszr Charts, die zu diesem Begriff passen
 * (LLM-Zuordnung bei Anlage, s. glossary_term_products).
 *
 * Darstellung übernommen von components/rankings/related-products.tsx
 * („Weitere Produkte in dieser Kategorie"): zweispaltiges Kartengitter mit
 * Vendor-Logo, Name und Score. Damit sieht die Produktliste im Lexikon genauso
 * aus wie in den Rankings — derselbe Inhaltstyp, dieselbe Form.
 *
 * Steht UNTER dem Erklärtext, nicht in der Navigationsspalte: die Karten
 * brauchen Breite für Logo, Name und Zahl, und sie sind Inhalt, keine
 * Navigation. In der 11rem-Spalte stehen nur verwandte Begriffe und das
 * A-Z-Register.
 *
 * KEINE Sparkline, obwohl die Rankings eine zeigen: die bräuchte
 * getCategoryCappedProducts(cap, includeHistory=TRUE), und dieser history-JSONB
 * war die Hauptursache der Supabase-Egress-Overage (project_supabase_egress).
 * Der Artikel-SSR-Pfad verzichtet aus demselben Grund darauf.
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
      <h2 className="mb-3 text-lg font-semibold">{heading}</h2>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {products.map((product) => (
          <li key={product.slug}>
            <Link
              href={`/${lang}/rankings/${product.slug}`}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-foreground"
            >
              {product.vendor && <VendorAvatar vendor={product.vendor} size={22} />}
              <span className="truncate font-medium">{product.canonicalName}</span>
              {typeof product.score === 'number' && (
                <span className="ml-auto shrink-0 font-bold tabular-nums">{product.score}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
