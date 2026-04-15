import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { CompanyDetailClient } from '@/app/companies/[slug]/company-detail-client'
import { getTranslations } from '@/lib/i18n/get-translations'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import { parseTipTapContent } from '@/lib/companies/extractor'
import type { LanguageCode } from '@/lib/types'
import type { Metadata } from 'next'

interface TipTapNode {
  type?: string
  text?: string
  content?: TipTapNode[]
  attrs?: { level?: number; [key: string]: unknown }
}

function extractTextFromNode(node: TipTapNode): string {
  if (node.text) return node.text
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromNode).join(' ')
  }
  return ''
}

function extractExcerpt(text: string, maxLength = 150): string {
  const cleaned = text.replace(/\{[^}]+\}/g, '').replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  const truncated = cleaned.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  if (lastSpace > maxLength * 0.7) return truncated.slice(0, lastSpace) + '...'
  return truncated + '...'
}

/** Extract H2-delimited articles from TipTap content, same skip rules as extractor.ts */
function extractArticlesFromContent(content: unknown): { headline: string; excerpt: string }[] {
  if (!content || typeof content !== 'object') return []
  const root = content as TipTapNode
  if (!root.content || !Array.isArray(root.content)) return []

  const articles: { headline: string; text: string }[] = []
  let current: { headline: string; text: string } | null = null

  for (const node of root.content) {
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const headlineText = extractTextFromNode(node)
      const lower = headlineText.toLowerCase()
      if (
        lower.includes('synthszr take') ||
        lower.includes('synthszr contra') ||
        lower.includes('mattes synthese') ||
        lower.includes("mattes' synthese")
      ) {
        continue
      }
      current = { headline: headlineText, text: headlineText }
      articles.push(current)
    } else if (current) {
      const nodeText = extractTextFromNode(node)
      if (nodeText.trim()) current.text += ' ' + nodeText
    }
  }

  return articles.map((a) => ({ headline: a.headline, excerpt: extractExcerpt(a.text) }))
}

export const dynamic = 'force-dynamic'

interface PostInfo {
  id: string
  title: string
  slug: string | null
  created_at: string
}

interface CompanyMention {
  company_name: string
  company_slug: string
  company_type: 'public' | 'premarket'
  article_index: number | null
  article_headline: string | null
  article_excerpt: string | null
  post: PostInfo
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
  const { lang, slug } = await params
  const supabase = await createClient()

  // Fetch company name from mentions (case-insensitive)
  const { data: mention } = await supabase
    .from('post_company_mentions')
    .select('company_name')
    .ilike('company_slug', slug)
    .limit(1)
    .single()

  const companyName = mention?.company_name || slug

  return generateLocalizedMetadata({
    title: `${companyName} — Synthszr`,
    description: `Alle Artikel und Synthszr-Bewertungen zu ${companyName}`,
    path: `/companies/${slug}`,
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
  const { lang, slug } = await params
  const locale = lang as LanguageCode
  const supabase = await createClient()
  const t = await getTranslations(locale)

  // Resolve slug case-insensitively against known companies
  const knownCompany = resolveCompanyBySlug(slug)

  // Fetch company mentions with article-level detail (case-insensitive slug match)
  const { data: mentions, error } = await supabase
    .from('post_company_mentions')
    .select(`
      company_name,
      company_slug,
      company_type,
      article_index,
      article_headline,
      article_excerpt,
      post:generated_posts!inner(
        id,
        title,
        slug,
        created_at,
        status
      )
    `)
    .ilike('company_slug', slug)
    .eq('post.status', 'published')
    .order('created_at', { ascending: false })

  if (error) {
    console.error(`[companies/${slug}] Query error:`, error)
  }

  // Cast and filter
  const typedMentions = (mentions || []) as unknown as CompanyMention[]

  // 404 only if the slug is not a known company at all
  if (typedMentions.length === 0 && !knownCompany) {
    notFound()
  }

  // Extract company info (prefer DB data, fall back to known company lookup)
  const firstMention = typedMentions[0]
  const company = firstMention
    ? { name: firstMention.company_name, slug: firstMention.company_slug, type: firstMention.company_type }
    : knownCompany!

  // For non-German locales, load translated post content so we can show
  // localized article headlines + excerpts instead of the German originals
  // stored in post_company_mentions.
  const translatedArticlesByPost = new Map<string, { headline: string; excerpt: string }[]>()
  if (locale !== 'de') {
    const postIds = Array.from(new Set(typedMentions.map((m) => m.post.id)))
    if (postIds.length > 0) {
      const { data: translations } = await supabase
        .from('content_translations')
        .select('generated_post_id, content')
        .in('generated_post_id', postIds)
        .eq('language_code', locale)
        .eq('translation_status', 'completed')

      for (const t of (translations || []) as { generated_post_id: string; content: unknown }[]) {
        const parsed = parseTipTapContent(t.content as string | object)
        const articles = extractArticlesFromContent(parsed)
        if (articles.length > 0) {
          translatedArticlesByPost.set(t.generated_post_id, articles)
        }
      }
    }
  }

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <Link
          href={`/${locale}/companies`}
          className="mb-8 inline-flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          {t['companies.all_companies']}
        </Link>

        <CompanyDetailClient company={company} articles={articles} locale={locale} translations={t} />
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
