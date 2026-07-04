import Link from 'next/link'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Search, FileText, BarChart3, Building2 } from 'lucide-react'
import { getTranslations } from '@/lib/i18n/get-translations'
import type { LanguageCode } from '@/lib/types'
import { SITE_URL } from '@/lib/seo/site'
import { BloomLanguageSwitcher } from '@/components/bloom-language-switcher'
import { SiteFooter } from '@/components/site-footer'

// Suche ist query-abhängig → immer frisch, nicht prerendern/cachen.
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ q?: string }>
}

interface PostHit { id: string; title: string; slug: string; excerpt: string | null; snippet: string | null; created_at: string }
interface CompanyHit { name: string; slug: string; type: 'public' | 'premarket' }
interface ProductHit { name: string; slug: string; category: string | null; catRank: number }
interface SearchData { posts: PostHit[]; companies: CompanyHit[]; products: ProductHit[] }

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { lang } = await params
  const { q } = await searchParams
  const query = (q || '').trim()
  const locale = lang as LanguageCode
  const title = query
    ? (locale === 'de' ? `Suche: „${query}" | Synthszr` : `Search: “${query}” | Synthszr`)
    : (locale === 'de' ? 'Suche | Synthszr' : 'Search | Synthszr')
  // Suchergebnisseiten gehören nicht in den Index (Thin/Duplicate), aber Links folgen.
  return { title, robots: { index: false, follow: true } }
}

export default async function SearchPage({ params, searchParams }: PageProps) {
  const { lang } = await params
  const { q } = await searchParams
  const locale = lang as LanguageCode
  const query = (q || '').trim()
  const t = await getTranslations(locale)
  const tr = (key: string, fallback: string) => t[key] ?? fallback

  let data: SearchData = { posts: [], companies: [], products: [] }
  if (query.length >= 2) {
    try {
      const res = await fetch(
        `${SITE_URL}/api/search?q=${encodeURIComponent(query)}&locale=${encodeURIComponent(locale)}&full=1`,
        { cache: 'no-store' },
      )
      if (res.ok) data = await res.json()
    } catch { /* Netzfehler → leere Ergebnisse */ }
  }

  const total = data.posts.length + data.products.length + data.companies.length

  return (
    <>
      <main className="max-w-3xl mx-auto px-4 py-10">
        <Suspense fallback={null}>
          <BloomLanguageSwitcher currentLocale={locale} />
        </Suspense>

        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">
          {locale === 'de' ? 'Suche' : 'Search'}
        </h1>

        {/* Native GET-Formular → navigiert zu /[lang]/search?q=… */}
        <form action={`/${locale}/search`} method="get" className="relative mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={locale === 'de' ? 'Suche in Blog, Charts oder nach Unternehmen…' : 'Search blog, charts or companies…'}
            className="w-full rounded-full border border-border bg-background pl-11 pr-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-neon-cyan"
            autoComplete="off"
          />
        </form>

        {query.length >= 2 && total === 0 && (
          <p className="text-sm text-muted-foreground">
            {locale === 'de' ? `Keine Treffer für „${query}".` : `No results for “${query}”.`}
          </p>
        )}

        {/* 1. Blog Posts */}
        {data.posts.length > 0 && (
          <section className="mb-8">
            <h2 className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">
              <FileText className="h-3.5 w-3.5" /> {tr('search.posts', 'Blogposts')} ({data.posts.length})
            </h2>
            <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {data.posts.map((p) => (
                <li key={p.id}>
                  <Link href={`/${locale}/posts/${p.slug}?q=${encodeURIComponent(query)}`} className="block px-4 py-3 hover:bg-muted/30 transition-colors">
                    <div className="font-medium text-sm leading-snug">{p.title}</div>
                    {(p.snippet || p.excerpt) && (
                      <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{p.snippet || p.excerpt}</div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 2. Synthszr Charts */}
        {data.products.length > 0 && (
          <section className="mb-8">
            <h2 className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">
              <BarChart3 className="h-3.5 w-3.5" /> Synthszr Charts ({data.products.length})
            </h2>
            <ul className="flex flex-wrap gap-2">
              {data.products.map((p) => (
                <li key={p.slug}>
                  <Link href={`/${locale}/rankings/${p.slug}`} className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm hover:bg-secondary transition-colors">
                    {p.name}
                    <span className="text-xs text-muted-foreground">#{p.catRank}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 3. Synthszr Stock (Unternehmen) */}
        {data.companies.length > 0 && (
          <section className="mb-8">
            <h2 className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">
              <Building2 className="h-3.5 w-3.5" /> Synthszr Stock ({data.companies.length})
            </h2>
            <ul className="flex flex-wrap gap-2">
              {data.companies.map((c) => (
                <li key={`${c.type}:${c.slug}`}>
                  <Link href={`/${locale}/companies/${encodeURIComponent(c.slug.toLowerCase())}`} className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-sm hover:bg-secondary transition-colors">
                    {c.name}
                    <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">{c.type === 'public' ? 'Public' : 'Premarket'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter locale={locale} />
    </>
  )
}
