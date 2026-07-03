import Link from 'next/link'
import { getRankedProducts } from '@/lib/rankings/leaderboard'
import { getTranslations } from '@/lib/i18n/get-translations'
import { findMentionedProducts, extractVisibleText } from '@/lib/posts/product-mentions'
import type { LanguageCode } from '@/lib/types'

/** Server-gerenderte, crawlbare Links auf Chart-Produkte, die im Post
 *  namentlich vorkommen — Ergänzung zu den client-seitigen Inline-Links des
 *  TiptapRenderers (die stehen nicht im initialen HTML). */
export async function PostProductLinks({
  content,
  locale,
}: {
  content: Record<string, unknown>
  locale: LanguageCode
}) {
  let products: Awaited<ReturnType<typeof getRankedProducts>>
  try {
    products = await getRankedProducts({ limit: 1000, minMentions: 2 })
  } catch {
    return null
  }
  const mentioned = findMentionedProducts(extractVisibleText(content), products, 8)
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
              {p.rank && <span className="text-muted-foreground">#{p.rank}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
