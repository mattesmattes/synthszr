import { Suspense } from "react"
import { notFound } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { PostContentView } from "@/components/post-content-view"
import { Newsletter } from "@/components/newsletter"
import { SwipeNavigation } from "@/components/swipe-navigation"
import { LanguageSwitcher } from "@/components/language-switcher"
import { BloomLanguageSwitcher } from "@/components/bloom-language-switcher"
import { AudioPlayer } from "@/components/audio-player"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { getTranslations } from "@/lib/i18n/get-translations"
import { generateLocalizedMetadata } from "@/lib/i18n/metadata"
import { formatUpdateDate, LOCALE_STRINGS } from "@/lib/i18n/config"
import type { LanguageCode } from "@/lib/types"
import type { Metadata } from "next"

// Disable caching for posts to always show current cover image
export const dynamic = 'force-dynamic'

interface PostData {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: Record<string, unknown>
  originalContent?: Record<string, unknown> // Original German content for company detection
  category: string
  created_at: string
  cover_image_url?: string | null
  pending_queue_item_ids?: string[] | null
}

interface AdjacentPost {
  slug: string
  title: string
  created_at: string
}

interface PageProps {
  params: Promise<{ lang: string; slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, slug } = await params
  const locale = lang as LanguageCode
  const supabase = await createClient()

  // Try to find post
  let post: { title: string; excerpt: string | null } | null = null
  let postId: string | null = null

  const { data: manualPost } = await supabase
    .from("posts")
    .select("title, excerpt")
    .eq("slug", slug)
    .eq("published", true)
    .single()

  if (manualPost) {
    post = manualPost
  } else {
    // Try by original slug
    const { data: aiPost } = await supabase
      .from("generated_posts")
      .select("id, title, excerpt")
      .eq("slug", slug)
      .eq("status", "published")
      .single()

    if (aiPost) {
      post = aiPost
      postId = aiPost.id
    } else if (locale !== 'de') {
      // Try by translated slug
      const { data: translationBySlug } = await supabase
        .from('content_translations')
        .select('generated_post_id, title, excerpt')
        .eq('slug', slug)
        .eq('language_code', locale)
        .eq('translation_status', 'completed')
        .single()

      if (translationBySlug) {
        post = {
          title: translationBySlug.title || '',
          excerpt: translationBySlug.excerpt
        }
        postId = translationBySlug.generated_post_id
      }
    }
  }

  // If we found a post by original slug and locale is not German, get translated metadata
  if (post && postId && locale !== 'de') {
    const { data: translation } = await supabase
      .from('content_translations')
      .select('title, excerpt')
      .eq('generated_post_id', postId)
      .eq('language_code', locale)
      .eq('translation_status', 'completed')
      .single()

    if (translation) {
      post = {
        title: translation.title || post.title,
        excerpt: translation.excerpt ?? post.excerpt
      }
    }
  }

  if (!post) {
    return { title: 'Not Found' }
  }

  return generateLocalizedMetadata({
    title: `${post.title} — Synthszr`,
    description: post.excerpt || undefined,
    path: `/posts/${slug}`,
  })
}

export default async function PostPage({ params }: PageProps) {
  const { lang, slug } = await params
  const locale = lang as LanguageCode
  const t = await getTranslations(locale)
  const supabase = await createClient()

  // Try to find in manual posts first
  let { data: post } = await supabase
    .from("posts")
    .select("*")
    .eq("slug", slug)
    .eq("published", true)
    .single()

  // If not found, try AI-generated posts
  if (!post) {
    // First try by original slug
    let { data: aiPost } = await supabase
      .from("generated_posts")
      .select("id, title, slug, excerpt, content, category, created_at, cover_image_id, pending_queue_item_ids")
      .eq("slug", slug)
      .eq("status", "published")
      .single()

    // If not found and locale is not German, try finding by translated slug
    if (!aiPost && locale !== 'de') {
      const { data: translationBySlug } = await supabase
        .from('content_translations')
        .select('generated_post_id')
        .eq('slug', slug)
        .eq('language_code', locale)
        .eq('translation_status', 'completed')
        .single()

      if (translationBySlug?.generated_post_id) {
        const { data: postByTranslatedSlug } = await supabase
          .from("generated_posts")
          .select("id, title, slug, excerpt, content, category, created_at, cover_image_id, pending_queue_item_ids")
          .eq("id", translationBySlug.generated_post_id)
          .eq("status", "published")
          .single()
        aiPost = postByTranslatedSlug
      }
    }

    if (aiPost) {
      // Fetch cover image if exists
      let coverImageUrl: string | null = null
      if (aiPost.cover_image_id) {
        const { data: coverImage } = await supabase
          .from("post_images")
          .select("image_url")
          .eq("id", aiPost.cover_image_id)
          .single()
        coverImageUrl = coverImage?.image_url || null
      }

      // Parse original content
      const originalContent = typeof aiPost.content === 'string' ? JSON.parse(aiPost.content) : aiPost.content

      // Fetch translation if not default locale
      let translatedTitle = aiPost.title
      let translatedExcerpt = aiPost.excerpt
      let translatedContent = originalContent
      let hasTranslation = false

      if (locale !== 'de') {
        const { data: translation } = await supabase
          .from('content_translations')
          .select('title, excerpt, content')
          .eq('generated_post_id', aiPost.id)
          .eq('language_code', locale)
          .eq('translation_status', 'completed')
          .single()

        if (translation) {
          translatedTitle = translation.title || aiPost.title
          translatedExcerpt = translation.excerpt ?? aiPost.excerpt
          translatedContent = translation.content as Record<string, unknown> || originalContent
          hasTranslation = true
        }
      }

      post = {
        ...aiPost,
        title: translatedTitle,
        excerpt: translatedExcerpt,
        category: aiPost.category || 'AI & Tech',
        content: translatedContent,
        // Pass original German content for company detection when using translation
        originalContent: hasTranslation ? originalContent : undefined,
        cover_image_url: coverImageUrl,
        pending_queue_item_ids: aiPost.pending_queue_item_ids
      } as PostData
    }
  }

  if (!post) {
    notFound()
  }

  // Fetch adjacent posts for navigation
  const currentDate = post.created_at

  // Get newer post (next)
  const { data: newerPosts } = await supabase
    .from("generated_posts")
    .select("slug, title, created_at")
    .eq("status", "published")
    .gt("created_at", currentDate)
    .order("created_at", { ascending: true })
    .limit(1)

  // Get older post (previous)
  const { data: olderPosts } = await supabase
    .from("generated_posts")
    .select("slug, title, created_at")
    .eq("status", "published")
    .lt("created_at", currentDate)
    .order("created_at", { ascending: false })
    .limit(1)

  const newerPost: AdjacentPost | null = newerPosts?.[0] || null
  const olderPost: AdjacentPost | null = olderPosts?.[0] || null

  const formatDateWithWeekday = (date: string) => {
    return formatUpdateDate(date, locale)
  }

  const formatNavDate = (date: string) => {
    return new Date(date).toLocaleDateString(LOCALE_STRINGS[locale] ?? 'en-US', {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  }

  return (
    <SwipeNavigation
      olderPostSlug={olderPost?.slug ? `/${locale}/posts/${olderPost.slug}` : undefined}
      newerPostSlug={newerPost?.slug ? `/${locale}/posts/${newerPost.slug}` : undefined}
      homeUrl={`/${locale}`}
    >
    <div className="min-h-screen bg-background text-foreground">

        <main className="mx-auto w-[704px] max-w-full px-6 py-12 md:py-20">

        {/* Header - same as homepage */}
        <BloomLanguageSwitcher currentLocale={locale} />

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

        <article>
          {/* Cover Image with centered Logo overlay - links to home */}
          {/* Fixed 704px width for moiré-free dithering (1:2 of 1408px) */}
          {/* Mobile: 704x704 (1:1 square), Desktop: 704x384 (11:6) */}
          {post.cover_image_url && (
            <div className="relative mb-8 rounded-lg overflow-hidden -mx-6">
              <div className="relative flex flex-col items-center justify-center mx-auto w-[704px] max-w-full aspect-square md:aspect-[11/6] bg-neon-cyan">
                {/* Clickable background to home */}
                <Link href={`/${locale}`} className="absolute inset-0 z-0">
                  <img
                    src={post.cover_image_url}
                    alt=""
                    className="w-full h-full object-cover"
                    style={{ imageRendering: 'pixelated' }}
                  />
                </Link>
                {/* Logo centered - w-full on mobile so percentage resolves against cover width */}
                <Link href={`/${locale}`} className="relative z-10 w-full flex justify-center md:w-auto">
                  <img
                    src="/synthszr-logo.svg"
                    alt="Synthszr"
                    className="h-auto w-[80%] md:h-24 md:w-auto md:max-w-[400px]"
                  />
                </Link>
                {/* Audio Player - directly under logo */}
                <div className="relative z-10 mt-3 flex items-center gap-2">
                  <Suspense fallback={null}>
                    <AudioPlayer postId={post.id} locale={locale === 'de' ? 'de' : 'en'} />
                  </Suspense>
                </div>
              </div>
            </div>
          )}

          <header className="mb-12 border-b border-border pb-8">
            <div className="mb-4">
              <span className="inline-block px-2 py-1 font-mono text-xs font-medium text-black bg-neon-yellow">
                {formatDateWithWeekday(post.created_at)}
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight md:text-2xl">{post.title}</h1>
            {post.excerpt && (
              post.excerpt.includes('•') ? (
                <ul className="mt-4 space-y-1 text-lg text-muted-foreground md:text-sm list-none pl-0">
                  {post.excerpt.split('\n').filter((l: string) => l.trim().startsWith('•')).map((line: string, i: number) => (
                    <li key={i}>{line.trim()}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-lg text-muted-foreground md:text-sm">{post.excerpt}</p>
              )
            )}
          </header>

          <div className="prose-headings:font-bold prose-headings:tracking-tight prose-h1:text-xl prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3 prose-p:mb-5 prose-blockquote:border-l-2 prose-blockquote:border-accent prose-blockquote:pl-6 prose-blockquote:italic">
            <Suspense fallback={null}>
              <PostContentView
                content={post.content}
                postId={post.id}
                queueItemIds={post.pending_queue_item_ids || undefined}
                originalContent={post.originalContent}
              />
            </Suspense>
          </div>
        </article>

        <nav className="mt-16 border-t border-border pt-8">
          <div className="flex justify-between items-center">
            {newerPost ? (
              <Link
                href={`/${locale}/posts/${newerPost.slug}`}
                className="flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-3 w-3" />
                {formatNavDate(newerPost.created_at)}
              </Link>
            ) : (
              <Link
                href={`/${locale}`}
                className="flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-3 w-3" />
                {t['common.home'] || 'Home'}
              </Link>
            )}
            {olderPost && (
              <Link
                href={`/${locale}/posts/${olderPost.slug}`}
                className="flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {formatNavDate(olderPost.created_at)}
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </nav>

        <Newsletter locale={locale} />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-12">
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
    </SwipeNavigation>
  )
}
