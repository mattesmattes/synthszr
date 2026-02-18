import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { CompanyDetailClient } from '@/app/companies/[slug]/company-detail-client'
import { getTranslations } from '@/lib/i18n/get-translations'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import type { LanguageCode } from '@/lib/types'
import type { Metadata } from 'next'

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

  // Fetch company name from mentions
  const { data: mention } = await supabase
    .from('post_company_mentions')
    .select('company_name')
    .eq('company_slug', slug)
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

export default async function CompanyDetailPage({ params }: PageProps) {
  const { lang, slug } = await params
  const locale = lang as LanguageCode
  const supabase = await createClient()
  const t = await getTranslations(locale)

  // Fetch company mentions with article-level detail
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
    .eq('company_slug', slug)
    .eq('post.status', 'published')
    .order('created_at', { ascending: false })

  if (error) {
    console.error(`[companies/${slug}] Query error:`, error)
  }

  // Cast and filter
  const typedMentions = (mentions || []) as unknown as CompanyMention[]

  if (typedMentions.length === 0) {
    notFound()
  }

  // Extract company info
  const firstMention = typedMentions[0]
  const company = {
    name: firstMention.company_name,
    slug: firstMention.company_slug,
    type: firstMention.company_type,
  }

  // Build articles list from mentions
  const articles: ArticleInfo[] = typedMentions
    .filter(m => m.article_headline) // Only include mentions with article data
    .map(m => ({
      postId: m.post.id,
      postSlug: m.post.slug || m.post.id,
      postCreatedAt: m.post.created_at,
      articleIndex: m.article_index ?? 0,
      headline: m.article_headline || m.post.title,
      excerpt: m.article_excerpt || '',
    }))
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
