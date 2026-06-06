import { Suspense } from "react"
import ReactDOM from "react-dom"
import { notFound } from "next/navigation"
import Link from "next/link"
import { createAnonClient } from "@/lib/supabase/admin"
import { PostContentView } from "@/components/post-content-view"
import { Newsletter } from "@/components/newsletter"
import { AdPromo } from "@/components/ad-promo"
import { SwipeNavigation } from "@/components/swipe-navigation"
import { LanguageSwitcher } from "@/components/language-switcher"
import { BloomLanguageSwitcher } from "@/components/bloom-language-switcher"
import { HomeSearch } from "@/components/home-search"
import { PostSearchHighlight } from "@/components/post-search-highlight"
import { AudioPlayer } from "@/components/audio-player"
import { PodcastBadges } from "@/components/podcast-badges"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { getTranslations } from "@/lib/i18n/get-translations"
import { generateLocalizedMetadata } from "@/lib/i18n/metadata"
import { formatUpdateDate, LOCALE_STRINGS } from "@/lib/i18n/config"
import type { LanguageCode } from "@/lib/types"
import type { Metadata } from "next"

// ISR: revalidate every 60s. Post + translation reads use the anon client,
// so Next.js prerenders and the Vercel edge caches. Invalidate via
// revalidatePath() when a post is edited.
export const revalidate = 60

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
  desktop_cover_url?: string | null
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
  const supabase = createAnonClient()

  // Try to find post
  let post: { title: string; excerpt: string | null; cover_image_url?: string | null; created_at?: string } | null = null
  let postId: string | null = null

  const { data: manualPost } = await supabase
    .from("posts")
    .select("title, excerpt, cover_image_url, created_at")
    .eq("slug", slug)
    .eq("published", true)
    .single()

  if (manualPost) {
    post = manualPost
  } else {
    // Try by original slug
    const { data: aiPost } = await supabase
      .from("generated_posts")
      .select("id, title, excerpt, cover_image_id, created_at")
      .eq("slug", slug)
      .eq("status", "published")
      .single()

    if (aiPost) {
      // Fetch cover image URL for OG tags
      let coverImageUrl: string | null = null
      if (aiPost.cover_image_id) {
        const { data: coverImage } = await supabase
          .from("post_images")
          .select("image_url")
          .eq("id", aiPost.cover_image_id)
          .single()
        coverImageUrl = coverImage?.image_url || null
      }
      post = { ...aiPost, cover_image_url: coverImageUrl }
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
    locale: locale,
    ogImage: post.cover_image_url || undefined,
    ogType: 'article',
  })
}

export default async function PostPage({ params }: PageProps) {
  const { lang, slug } = await params
  const locale = lang as LanguageCode
  const t = await getTranslations(locale)
  const supabase = createAnonClient()

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
      .select("id, title, slug, excerpt, content, category, created_at, updated_at, cover_image_id, pending_queue_item_ids")
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
          .select("id, title, slug, excerpt, content, category, created_at, updated_at, cover_image_id, pending_queue_item_ids")
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

      // Fetch desktop cover if exists
      let desktopCoverUrl: string | null = null
      if (aiPost.id) {
        const { data: desktopCover } = await supabase
          .from('post_images')
          .select('image_url')
          .eq('post_id', aiPost.id)
          .eq('image_type', 'cover_desktop')
          .eq('generation_status', 'completed')
          .single()
        desktopCoverUrl = desktopCover?.image_url || null
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
        desktop_cover_url: desktopCoverUrl,
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

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    datePublished: post.created_at,
    ...(post.updated_at && { dateModified: post.updated_at }),
    author: { '@type': 'Organization', name: 'Synthszr' },
    publisher: { '@type': 'Organization', name: 'Synthszr' },
    ...(post.excerpt && { description: post.excerpt }),
    ...(post.cover_image_url && { image: post.cover_image_url }),
  }

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `https://synthszr.com/${locale}` },
      { '@type': 'ListItem', position: 2, name: 'Archive', item: `https://synthszr.com/${locale}/archive` },
      { '@type': 'ListItem', position: 3, name: post.title },
    ],
  }

  // Preload the LCP cover so the browser begins the image fetch in parallel
  // with HTML parsing — closes the "LCP request discovery" gap.
  if (post.cover_image_url) {
    ReactDOM.preload(post.cover_image_url, { as: "image", fetchPriority: "high" })
  }

  return (
    <SwipeNavigation
      olderPostSlug={olderPost?.slug ? `/${locale}/posts/${olderPost.slug}` : undefined}
      newerPostSlug={newerPost?.slug ? `/${locale}/posts/${newerPost.slug}` : undefined}
      homeUrl={`/${locale}`}
    >
    <div className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

        <main className="mx-auto w-[704px] max-w-full px-6 py-12 md:py-20">

        {/* Header - same as homepage */}
        <Suspense fallback={null}>
          <BloomLanguageSwitcher currentLocale={locale} />
        </Suspense>

        <HomeSearch locale={locale} />
        <Suspense fallback={null}>
          <PostSearchHighlight targetId="post-article" />
        </Suspense>

        <article id="post-article">
          {/* Cover Image with centered Logo overlay - links to home */}
          {/* Fixed 704px width for moiré-free dithering (1:2 of 1408px) */}
          {/* Mobile: 704x704 (1:1 square), Desktop: 704x384 (11:6) */}
          {post.cover_image_url && (
            <div className="relative mb-8 overflow-hidden -mx-6">
              <div className="relative flex flex-col items-center justify-center mx-auto w-[704px] max-w-full aspect-[16/9] md:aspect-[11/6] bg-neon-cyan">
                {/* Clickable background to home */}
                <Link href={`/${locale}`} className="absolute inset-0 z-0">
                  <picture className="block w-full h-full">
                    {post.desktop_cover_url && (
                      <source media="(min-width: 768px)" srcSet={post.desktop_cover_url} />
                    )}
                    <img
                      src={post.cover_image_url}
                      alt={post.title}
                      width={1408}
                      height={1408}
                      // .dithered-cover: pixelated above 500px viewport,
                      // bilinear below — see app/globals.css for rationale.
                      className="w-full h-full object-cover dithered-cover"
                      fetchPriority="high"
                      decoding="async"
                    />
                  </picture>
                </Link>
                {/* Logo centered - w-full on mobile so percentage resolves against cover width */}
                <Link href={`/${locale}`} className="relative z-10 w-full flex justify-center md:w-auto">
                  <img
                    src="/synthszr-logo.svg"
                    alt="Synthszr"
                    width={400}
                    height={96}
                    decoding="async"
                    className="h-auto w-[80%] md:h-24 md:w-auto md:max-w-[400px]"
                  />
                </Link>
              </div>
              <PodcastBadges>
                <Suspense fallback={null}>
                  <AudioPlayer postId={post.id} locale={locale === 'de' ? 'de' : 'en'} />
                </Suspense>
              </PodcastBadges>
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

        <AdPromo />
        <Newsletter locale={locale} />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-6">
              <a href="https://oh-so.com" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
                <img
                  src="/oh-so-logo.svg"
                  alt="OH-SO"
                  width={86}
                  height={36}
                  loading="lazy"
                  decoding="async"
                  className="h-9"
                />
              </a>
              <Suspense fallback={null}>
                <LanguageSwitcher currentLocale={locale} />
              </Suspense>
            </div>
            <div className="flex gap-6 text-xs">
              <a href="https://www.linkedin.com/in/mattes/" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">
                LinkedIn
              </a>
              <a href={`/${locale}/sources`} className="hover:text-accent transition-colors">
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
