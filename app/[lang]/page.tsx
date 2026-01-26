import Link from "next/link"
import { FeaturedArticle } from "@/components/featured-article"
import { Newsletter } from "@/components/newsletter"
import { LanguageSwitcher } from "@/components/language-switcher"
import { BloomLanguageSwitcher } from "@/components/bloom-language-switcher"
import { createClient } from "@/lib/supabase/server"
import { getTranslations } from "@/lib/i18n/get-translations"
import { generateLocalizedMetadata } from "@/lib/i18n/metadata"
import type { LanguageCode } from "@/lib/types"
import type { Metadata } from "next"

// Disable caching to always show current cover images
export const dynamic = 'force-dynamic'

interface CombinedPost {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: Record<string, unknown>
  category: string
  created_at: string
  cover_image_url?: string | null
  pending_queue_item_ids?: string[] | null
}

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params
  const locale = lang as LanguageCode
  const t = await getTranslations(locale)

  return generateLocalizedMetadata({
    title: "Synthszr — AI is about Synthesis not Efficiency.",
    description: t['meta.description'] || "Exploring the intersection of business, design and technology in the age of AI",
    path: '/',
  })
}

export default async function Page({ params }: PageProps) {
  const { lang } = await params
  const locale = lang as LanguageCode
  const t = await getTranslations(locale)
  const supabase = await createClient()

  // Fetch manual posts
  const { data: manualPosts } = await supabase
    .from("posts")
    .select("*")
    .eq("published", true)
    .order("created_at", { ascending: false })

  // Fetch AI-generated posts that are published with cover images
  const { data: aiPosts } = await supabase
    .from("generated_posts")
    .select("id, title, slug, excerpt, content, category, created_at, cover_image_id, pending_queue_item_ids")
    .eq("status", "published")
    .order("created_at", { ascending: false })

  // Fetch translations if not default locale
  let translationsMap = new Map<string, { title: string; slug: string | null; excerpt: string | null; content: Record<string, unknown> }>()

  if (locale !== 'de' && aiPosts && aiPosts.length > 0) {
    const postIds = aiPosts.map(p => p.id)
    const { data: translations, error: translationError } = await supabase
      .from('content_translations')
      .select('generated_post_id, title, slug, excerpt, content')
      .eq('language_code', locale)
      .eq('translation_status', 'completed')
      .in('generated_post_id', postIds)

    console.log(`[i18n] Locale: ${locale}, Posts: ${postIds.length}, Translations found: ${translations?.length || 0}, Error: ${translationError?.message || 'none'}`)

    if (translations) {
      for (const t of translations) {
        if (t.generated_post_id) {
          translationsMap.set(t.generated_post_id, {
            title: t.title || '',
            slug: t.slug,
            excerpt: t.excerpt,
            content: t.content as Record<string, unknown>
          })
        }
      }
    }
  }

  // Fetch cover images for AI posts
  const coverImageIds = (aiPosts || [])
    .map(p => p.cover_image_id)
    .filter((id): id is string => !!id)

  const { data: coverImages } = coverImageIds.length > 0
    ? await supabase
        .from("post_images")
        .select("id, image_url")
        .in("id", coverImageIds)
    : { data: [] }

  const coverImageMap = new Map(
    (coverImages || []).map(img => [img.id, img.image_url])
  )

  // Parse AI posts content from JSON string if needed, apply translations
  const parsedAiPosts: CombinedPost[] = (aiPosts || []).map(post => {
    const translation = translationsMap.get(post.id)
    const originalContent = typeof post.content === 'string' ? JSON.parse(post.content) : post.content

    return {
      ...post,
      title: translation?.title || post.title,
      excerpt: translation?.excerpt ?? post.excerpt,
      content: translation?.content || originalContent,
      slug: translation?.slug || post.slug || post.id,
      category: post.category || 'AI & Tech',
      cover_image_url: post.cover_image_id ? coverImageMap.get(post.cover_image_id) : null,
      pending_queue_item_ids: post.pending_queue_item_ids
    }
  })

  // Combine and sort all posts
  const posts: CombinedPost[] = [
    ...(manualPosts || []),
    ...parsedAiPosts
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // Filter posts from the last 7 days (excluding featured)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(locale === 'de' ? "de-DE" : locale, {
      day: "2-digit",
      month: "2-digit",
    })
  }

  const formatDateFull = (date: string) => {
    return new Date(date).toLocaleDateString(locale === 'de' ? "de-DE" : locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  }

  const estimateReadTime = (content: Record<string, unknown>) => {
    const text = JSON.stringify(content)
    const words = text.split(/\s+/).length
    const minutes = Math.ceil(words / 200)
    return `${minutes} min`
  }

  const featuredPost = posts && posts.length > 0 ? posts[0] : null
  const recentPosts = posts
    .slice(1)
    .filter(post => new Date(post.created_at) >= sevenDaysAgo)

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 704px max-width to match cover image and post pages */}
      <main className="mx-auto w-[704px] max-w-full px-6 py-12 md:py-20">

        {/* Bloom Language Switcher */}
        <BloomLanguageSwitcher currentLocale={locale} />

        {featuredPost ? (
          <>
            {/* Why Link - above cover image */}
            <Link
              href={`/${locale}/why`}
              className="block mb-6 text-center hover:opacity-80 transition-opacity"
            >
              <span className="text-lg font-bold tracking-tight">
                Feed the Soul. Run the System.
              </span>
              <br />
              <span className="text-sm text-muted-foreground">
                The morning news synthesis to start your day.
              </span>
            </Link>

            <FeaturedArticle
              slug={featuredPost.slug}
              title={featuredPost.title}
              excerpt={featuredPost.excerpt}
              content={featuredPost.content}
              date={formatDateFull(featuredPost.created_at)}
              createdAt={featuredPost.created_at}
              readTime={estimateReadTime(featuredPost.content)}
              category={featuredPost.category.toUpperCase()}
              coverImageUrl={featuredPost.cover_image_url}
              locale={locale}
              postId={featuredPost.id}
              queueItemIds={featuredPost.pending_queue_item_ids || undefined}
            />

            {/* Last 7 Days Headlines */}
            {recentPosts.length > 0 && (
              <section className="mt-12">
                <h3 className="mb-4 font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Last 7 Days
                </h3>
                <div className="space-y-2 border-l-2 border-border pl-4">
                  {recentPosts.map((post) => (
                    <Link
                      key={post.id}
                      href={`/${locale}/posts/${post.slug}`}
                      className="group flex items-baseline gap-3 py-1 transition-colors hover:text-accent"
                    >
                      <span className="font-mono text-xs text-muted-foreground shrink-0">
                        {formatDate(post.created_at)}
                      </span>
                      <span className="text-sm font-medium group-hover:underline">
                        {post.title}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Archive Button */}
            <div className="mt-8">
              <Link
                href={`/${locale}/archive`}
                className="inline-flex items-center gap-2 rounded border border-border px-4 py-2 font-mono text-xs transition-colors hover:bg-secondary"
              >
                All Articles →
              </Link>
            </div>
          </>
        ) : (
          <div className="py-20 text-center">
            <p className="text-muted-foreground">{t['home.no_posts'] || 'No posts published yet.'}</p>
            <a href="/admin" className="mt-2 inline-block font-mono text-xs text-accent hover:underline">
              Go to Admin Panel →
            </a>
          </div>
        )}

        <Newsletter locale={locale} />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-[704px] max-w-full px-6 py-12">
          <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-6">
              <a href="https://oh-so.com" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
                <img src="/oh-so-logo.svg" alt="OH-SO" className="h-9" />
              </a>
              <LanguageSwitcher currentLocale={locale} />
            </div>
            <div className="flex gap-6 text-xs">
              <a href="https://www.linkedin.com/in/mattes/" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">
                LinkedIn
              </a>
              <a href="https://synthszr.com/en/sources" className="hover:text-accent transition-colors">
                {t['footer.sources'] || 'Sources'}
              </a>
              <Link href={`/${locale}/impressum`} className="hover:text-accent transition-colors">
                Imprint
              </Link>
              <Link href={`/${locale}/datenschutz`} className="hover:text-accent transition-colors">
                Privacy
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
