import Link from "next/link"
import { createClient } from "@/lib/supabase/server"

export const dynamic = 'force-dynamic'
import { ArrowLeft } from "lucide-react"
import { getTranslations } from "@/lib/i18n/get-translations"
import { generateLocalizedMetadata } from "@/lib/i18n/metadata"
import type { LanguageCode } from "@/lib/types"
import type { Metadata } from "next"

interface CombinedPost {
  id: string
  title: string
  slug: string
  excerpt: string | null
  category: string
  created_at: string
}

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params
  const t = await getTranslations(lang as LanguageCode)

  return generateLocalizedMetadata({
    title: `${t['archive.title'] || 'Archiv'} — Synthszr`,
    description: t['archive.description'] || 'Alle Artikel chronologisch sortiert',
    path: '/archive',
  })
}

export default async function ArchivePage({ params }: PageProps) {
  const { lang } = await params
  const locale = lang as LanguageCode
  const t = await getTranslations(locale)
  const supabase = await createClient()

  // Fetch manual posts
  const { data: manualPosts } = await supabase
    .from("posts")
    .select("id, title, slug, excerpt, category, created_at")
    .eq("published", true)
    .order("created_at", { ascending: false })

  // Fetch AI-generated posts that are published
  const { data: aiPosts } = await supabase
    .from("generated_posts")
    .select("id, title, slug, excerpt, category, created_at")
    .eq("status", "published")
    .order("created_at", { ascending: false })

  // Parse AI posts
  const parsedAiPosts: CombinedPost[] = (aiPosts || []).map(post => ({
    ...post,
    slug: post.slug || post.id,
    category: post.category || 'AI & Tech',
  }))

  // Combine and sort all posts (newest first)
  const posts: CombinedPost[] = [
    ...(manualPosts || []),
    ...parsedAiPosts
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(locale === 'de' ? "de-DE" : locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  }

  // Group posts by year-month
  const groupedPosts = posts.reduce((acc, post) => {
    const date = new Date(post.created_at)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const label = date.toLocaleDateString(locale === 'de' ? "de-DE" : locale, { month: "long", year: "numeric" })

    if (!acc[key]) {
      acc[key] = { label, posts: [] }
    }
    acc[key].posts.push(post)
    return acc
  }, {} as Record<string, { label: string; posts: CombinedPost[] }>)

  const sortedGroups = Object.entries(groupedPosts).sort((a, b) => b[0].localeCompare(a[0]))

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <Link
          href={`/${locale}`}
          className="mb-8 inline-flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          {t['common.back'] || 'Zurück'}
        </Link>

        <div className="mb-12 border-b border-border pb-8">
          <h1 className="text-3xl font-bold tracking-tight">{t['archive.title'] || 'Archiv'}</h1>
          <p className="mt-2 text-muted-foreground">
            {t['archive.count']?.replace('{count}', String(posts.length)) || `Alle ${posts.length} Artikel chronologisch sortiert`}
          </p>
        </div>

        {sortedGroups.length > 0 ? (
          <div className="space-y-10">
            {sortedGroups.map(([key, { label, posts: groupPosts }]) => (
              <section key={key}>
                <h2 className="mb-4 font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {label}
                </h2>
                <div className="space-y-3 border-l-2 border-border pl-4">
                  {groupPosts.map((post) => (
                    <Link
                      key={post.id}
                      href={`/${locale}/posts/${post.slug}`}
                      className="group block py-2 transition-colors"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatDate(post.created_at)}
                      </span>
                      <h3 className="mt-1 text-base font-medium group-hover:text-accent group-hover:underline">
                        {post.title}
                      </h3>
                      {post.excerpt && (
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                          {post.excerpt}
                        </p>
                      )}
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center">
            <p className="text-muted-foreground">{t['archive.empty'] || 'Noch keine Artikel vorhanden.'}</p>
          </div>
        )}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <Link href={`/${locale}`} className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground">
            ← {t['archive.back_home'] || 'Zurück zu Synthszr'}
          </Link>
        </div>
      </footer>
    </div>
  )
}
