import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { CompanyDetailClient } from './company-detail-client'
import { getTranslations } from '@/lib/i18n/get-translations'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import { getCompanyMentions, getTranslatedArticlesByPost, type CompanyMentionRow } from '@/lib/companies/company-page-data'
import { VendorProducts } from '@/components/rankings/vendor-products'
import { SITE_URL, safeJsonLd } from '@/lib/seo/site'
import type { LanguageCode } from '@/lib/types'
import type { Metadata } from 'next'

// On-demand ISR (siehe rankings/[slug]): Anon-Client + leeres
// generateStaticParams → Vercel cached 1h am Edge statt no-store.
export const revalidate = 3600

export async function generateStaticParams() {
  return []
}

type CompanyMention = CompanyMentionRow

/**
 * Erwähnungen aus dem Datencache (lib/companies/company-page-data.ts). Ein
 * Ladefehler ergibt eine leere Liste — wie zuvor bei einem Query-Fehler —, wird
 * aber NICHT gecacht, der nächste Aufruf versucht es erneut.
 */
async function loadMentions(slug: string): Promise<CompanyMention[]> {
  try {
    return await getCompanyMentions(slug.toLowerCase())
  } catch (err) {
    console.error(`[companies/${slug}] Query error:`, err instanceof Error ? err.message : err)
    return []
  }
}

interface ArticleInfo {
  postId: string
  postSlug: string
  postCreatedAt: string
  articleIndex: number
  headline: string
  excerpt: string
}

interface PageProps {
  params: Promise<{ lang: string; slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, slug: rawSlug } = await params
  // Next liefert Dynamic-Params percent-encoded ("Hugging%20Face") — ohne
  // Decode 404en alle Company-Slugs mit Leerzeichen (~105 Premarket-Firmen).
  const slug = decodeURIComponent(rawSlug)

  // Firmenname aus den (gecachten) Erwähnungen — derselbe Cache-Eintrag wie die
  // Seite selbst, also keine zusätzliche Abfrage.
  const companyName = (await loadMentions(slug))[0]?.company_name || slug

  return generateLocalizedMetadata({
    title: `${companyName} — Synthszr`,
    description: `Alle Artikel und Synthszr-Bewertungen zu ${companyName}`,
    // Canonical = Sitemap-kanonische Kleinschreibung, egal welche Case-Variante aufgerufen wird.
    path: `/companies/${encodeURIComponent(slug.toLowerCase())}`,
    locale: lang as LanguageCode,
  })
}

/**
 * Resolve a URL slug (case-insensitive) to a known company entry.
 * Returns { name, slug, type } or null if unknown.
 */
function resolveCompanyBySlug(slug: string): { name: string; slug: string; type: 'public' | 'premarket' } | null {
  const lower = slug.toLowerCase()
  for (const [displayName, apiSlug] of Object.entries(KNOWN_COMPANIES)) {
    if (apiSlug.toLowerCase() === lower) {
      return { name: displayName, slug: apiSlug, type: 'public' }
    }
  }
  for (const [displayName, apiSlug] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
    if (apiSlug.toLowerCase() === lower) {
      return { name: displayName, slug: apiSlug, type: 'premarket' }
    }
  }
  return null
}

export default async function CompanyDetailPage({ params }: PageProps) {
  const { lang, slug: rawSlug } = await params
  // Next liefert Dynamic-Params percent-encoded ("Hugging%20Face") — ohne
  // Decode 404en alle Company-Slugs mit Leerzeichen (~105 Premarket-Firmen).
  const slug = decodeURIComponent(rawSlug)
  const locale = lang as LanguageCode
  const t = await getTranslations(locale)

  // Resolve slug case-insensitively against known companies
  const knownCompany = resolveCompanyBySlug(slug)

  // Company mentions with article-level detail (case-insensitive slug match)
  const typedMentions = await loadMentions(slug)

  // 404 only if the slug is not a known company at all
  if (typedMentions.length === 0 && !knownCompany) {
    notFound()
  }

  // Extract company info (prefer DB data, fall back to known company lookup)
  const firstMention = typedMentions[0]
  const company = firstMention
    ? { name: firstMention.company_name, slug: firstMention.company_slug, type: firstMention.company_type }
    : knownCompany!

  // For non-German locales, use the translated headline + excerpt per article
  // instead of the German originals stored in post_company_mentions. Je Post
  // und Sprache gecacht und zwischen allen Firmen geteilt — vorher lud jeder
  // Render den vollen übersetzten Inhalt aller Posts (OpenAI/en: 8 MB).
  const translatedArticlesByPost = locale !== 'de'
    ? await getTranslatedArticlesByPost(Array.from(new Set(typedMentions.map((m) => m.post.id))), locale)
    : new Map<string, { headline: string; excerpt: string }[]>()

  // Build articles list from mentions, preferring translated headline/excerpt when available
  const articles: ArticleInfo[] = typedMentions
    .filter((m) => m.article_headline)
    .map((m) => {
      const idx = m.article_index ?? 0
      const translated = translatedArticlesByPost.get(m.post.id)?.[idx]
      return {
        postId: m.post.id,
        postSlug: m.post.slug || m.post.id,
        postCreatedAt: m.post.created_at,
        articleIndex: idx,
        headline: translated?.headline || m.article_headline || m.post.title,
        excerpt: translated?.excerpt || m.article_excerpt || '',
      }
    })
    .sort((a, b) => new Date(b.postCreatedAt).getTime() - new Date(a.postCreatedAt).getTime())

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Synthszr', item: `${SITE_URL}/${locale}` },
      { '@type': 'ListItem', position: 2, name: 'Companies', item: `${SITE_URL}/${locale}/companies` },
      { '@type': 'ListItem', position: 3, name: company.name },
    ],
  }

  const organizationLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: company.name,
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbLd) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(organizationLd) }} />
        <Link
          href={`/${locale}/companies`}
          className="mb-8 inline-flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          {t['companies.all_companies']}
        </Link>

        <CompanyDetailClient company={company} articles={articles} locale={locale} translations={t} />

        <VendorProducts
          lang={locale}
          vendor={slug}
          heading={t['rankings.company_products'] ?? 'Produkte in den Synthszr Charts'}
        />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <Link href={`/${locale}/companies`} className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground">
            ← {t['companies.back_to_companies']}
          </Link>
        </div>
      </footer>
    </div>
  )
}
