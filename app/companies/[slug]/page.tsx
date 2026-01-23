import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { CompanyDetailClient } from './company-detail-client'

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

export interface ArticleInfo {
  postId: string
  postSlug: string
  postCreatedAt: string
  articleIndex: number
  headline: string
  excerpt: string
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

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
          href="/companies"
          className="mb-8 inline-flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Alle Unternehmen
        </Link>

        <CompanyDetailClient company={company} articles={articles} />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <Link href="/companies" className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground">
            ← Zurück zu Unternehmen
          </Link>
        </div>
      </footer>
    </div>
  )
}
