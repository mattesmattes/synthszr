import Link from 'next/link'
import { getCategoryCappedProducts } from '@/lib/rankings/leaderboard'
import { getTranslations } from '@/lib/i18n/get-translations'
import { findMentionedProducts, extractVisibleText } from '@/lib/posts/product-mentions'
import { createAdminClient } from '@/lib/supabase/admin'
import type { LanguageCode } from '@/lib/types'

/** Server-gerenderte, crawlbare Links auf Chart-Produkte, die im Post
 *  namentlich vorkommen — Ergänzung zu den client-seitigen Inline-Links des
 *  TiptapRenderers (die stehen nicht im initialen HTML). Harter Cut: nur
 *  Produkte in den Top 50 ihrer Kategorie (konsistent zur Charts-Leiste). */
export async function PostProductLinks({
  content,
  locale,
}: {
  content: Record<string, unknown>
  locale: LanguageCode
}) {
  let products: Awaited<ReturnType<typeof getCategoryCappedProducts>>
  try {
    products = await getCategoryCappedProducts(50)
  } catch {
    return null
  }
  // Erst großzügig matchen (bis 24), dann auf Produkte MIT Beschreibung filtern —
  // referenziert werden nur recherchierte Produkte (keine leeren Stubs), Cut auf 8.
  const matched = findMentionedProducts(extractVisibleText(content), products, 24)
  if (matched.length === 0) return null
  let mentioned = matched
  try {
    const supabase = createAdminClient()
    const { data: descRows } = await supabase
      .from('product_features_current')
      .select('product_id')
      .eq('dimension_key', '__description')
      .in('product_id', matched.map((p) => p.id))
    const described = new Set((descRows ?? []).map((r) => r.product_id as string))
    mentioned = matched.filter((p) => described.has(p.id)).slice(0, 8)
  } catch {
    mentioned = matched.slice(0, 8) // DB-Fehler → nicht härter filtern als vorher
  }
  if (mentioned.length === 0) return null

  const t = await getTranslations(locale)
  return (
    <nav className="mt-8 border-t border-border pt-4">
      <h3 className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {t['post.mentioned_products'] ?? 'Im Artikel erwähnte Chart-Produkte'}
      </h3>
      <ul className="flex flex-wrap gap-2">
        {mentioned.map((p) => (
          <li key={p.slug}>
            <Link
              href={`/${locale}/rankings/${p.slug}`}
              className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs transition-colors hover:bg-secondary"
            >
              {p.canonicalName}
              {p.catRank && <span className="text-muted-foreground">#{p.catRank}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
