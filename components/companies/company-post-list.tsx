import Link from 'next/link'
import { LOCALE_STRINGS } from '@/lib/i18n/config'
import type { CompanyPostRef } from '@/lib/companies/recent-posts'
import type { LanguageCode } from '@/lib/types'

/**
 * „Die letzten News, in denen dieses Unternehmen vorkam" — auf der Stocks-Seite
 * unter der Analyse.
 *
 * Optik bewusst identisch zu components/glossary/term-news.tsx: dieselbe
 * Textlink-Liste mit Datumszeile. Beides ist derselbe Gedanke („wo taucht das
 * bei uns auf"), und zwei verschiedene Darstellungen dafür wären Willkür.
 *
 * Rendert null bei leerer Liste — eine Überschrift ohne Einträge ist schlechter
 * als kein Block.
 */
export function CompanyPostList({
  posts,
  lang,
  heading,
}: {
  posts: CompanyPostRef[]
  lang: string
  heading: string
}) {
  if (posts.length === 0) return null

  const fmt = (d: string) => {
    if (!d) return ''
    try {
      return new Date(d).toLocaleDateString(LOCALE_STRINGS[lang as LanguageCode] ?? 'de-DE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    } catch {
      return ''
    }
  }

  return (
    <section className="mt-10 border-t border-border pt-6">
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{heading}</h2>
      <ul className="space-y-3">
        {posts.map((post) => (
          <li key={post.slug} className="text-sm">
            <Link
              href={`/${lang}/posts/${post.slug}`}
              className="font-medium text-foreground/80 hover:text-foreground hover:underline"
            >
              {post.title}
            </Link>
            <div className="mt-0.5 text-xs text-muted-foreground/70">{fmt(post.createdAt)}</div>
          </li>
        ))}
      </ul>
    </section>
  )
}
