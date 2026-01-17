import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { CompanyDetailClient } from '@/app/companies/[slug]/company-detail-client'
import type { LanguageCode } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface PostInfo {
  id: string
  title: string
  slug: string | null
  excerpt: string | null
  created_at: string
}

interface CompanyMention {
  company_name: string
  company_slug: string
  company_type: 'public' | 'premarket'
  post: PostInfo
}

interface PageProps {
  params: Promise<{ lang: string; slug: string }>
}

export default async function CompanyDetailPage({ params }: PageProps) {
  const { lang, slug } = await params
  const locale = lang as LanguageCode
  const supabase = await createClient()

  // Fetch company mentions with posts
  const { data: mentions, error } = await supabase
    .from('post_company_mentions')
    .select(`
      company_name,
      company_slug,
      company_type,
      post:generated_posts!inner(
        id,
        title,
        slug,
        excerpt,
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

  // Extract unique posts
  const postMap = new Map<string, PostInfo>()
  for (const mention of typedMentions) {
    const post = mention.post
    if (!postMap.has(post.id)) {
      postMap.set(post.id, {
        id: post.id,
        title: post.title,
        slug: post.slug || post.id,
        excerpt: post.excerpt,
        created_at: post.created_at,
      })
    }
  }

  // Sort by date (newest first)
  const posts = Array.from(postMap.values())
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <Link
          href={`/${locale}/companies`}
          className="mb-8 inline-flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Alle Unternehmen
        </Link>

        <CompanyDetailClient company={company} posts={posts} locale={locale} />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <Link href={`/${locale}/companies`} className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground">
            ← Zurück zu Unternehmen
          </Link>
        </div>
      </footer>
    </div>
  )
}
