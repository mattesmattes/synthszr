import { Suspense } from "react"
import { notFound } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { BlogHeader } from "@/components/blog-header"
import { TiptapRenderer } from "@/components/tiptap-renderer"
import { Newsletter } from "@/components/newsletter"
import { SwipeNavigation } from "@/components/swipe-navigation"
import { BloomLanguageSwitcher } from "@/components/bloom-language-switcher"
import { ArrowLeft, ArrowRight } from "lucide-react"

// Disable caching for posts to always show current cover image
export const dynamic = 'force-dynamic'

interface PostData {
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

interface AdjacentPost {
  slug: string
  title: string
  created_at: string
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
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
    const { data: aiPost } = await supabase
      .from("generated_posts")
      .select("id, title, slug, excerpt, content, category, created_at, cover_image_id, pending_queue_item_ids")
      .eq("slug", slug)
      .eq("status", "published")
      .single()

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

      post = {
        ...aiPost,
        category: aiPost.category || 'AI & Tech',
        content: typeof aiPost.content === 'string' ? JSON.parse(aiPost.content) : aiPost.content,
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
    const d = new Date(date)
    const weekday = d.toLocaleDateString("de-DE", { weekday: "long" })
    const day = d.getDate().toString().padStart(2, '0')
    const month = (d.getMonth() + 1).toString().padStart(2, '0')
    const year = d.getFullYear()
    return `Update vom ${weekday}, den ${day}.${month}.${year}`
  }

  const formatNavDate = (date: string) => {
    return new Date(date).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  }

  return (
    <SwipeNavigation
      olderPostSlug={olderPost?.slug}
      newerPostSlug={newerPost?.slug}
    >
    <div className="min-h-screen bg-background text-foreground">
      {/* <BlogHeader /> */}

        <main className="mx-auto w-[704px] max-w-full px-6 py-12 md:py-20">

        {/* Header - same as homepage */}
        <BloomLanguageSwitcher currentLocale="de" />

        <Link
          href="/why"
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
            <Link href="/" className="block mb-8 rounded-lg overflow-hidden -mx-6">
              {/* -mx-6 compensates for parent padding to allow full 704px width */}
              <div
                className="relative flex items-center justify-center mx-auto w-[704px] max-w-[calc(100%+48px)] aspect-square md:aspect-[11/6] bg-neon-yellow"
              >
                {/* Dithered PNG - pixelated rendering for sharp dithering pattern */}
                <img
                  src={post.cover_image_url}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ imageRendering: 'pixelated' }}
                />
                {/* Logo centered on top */}
                <img
                  src="/synthszr-logo.svg"
                  alt="Synthszr"
                  className="relative z-10 h-20 md:h-24 w-auto"
                />
              </div>
            </Link>
          )}

          <header className="mb-12 border-b border-border pb-8">
            <div className="mb-4">
              <span className="inline-block px-2 py-1 font-mono text-xs font-medium text-black bg-neon-yellow">
                {formatDateWithWeekday(post.created_at)}
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight md:text-2xl">{post.title}</h1>
            {post.excerpt && <p className="mt-4 text-lg text-muted-foreground md:text-sm">{post.excerpt}</p>}
          </header>

          <div className="prose-headings:font-bold prose-headings:tracking-tight prose-h1:text-xl prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3 prose-p:mb-5 prose-blockquote:border-l-2 prose-blockquote:border-accent prose-blockquote:pl-6 prose-blockquote:italic">
            <Suspense fallback={null}>
              <TiptapRenderer content={post.content} postId={post.id} queueItemIds={post.pending_queue_item_ids || undefined} />
            </Suspense>
          </div>
        </article>

        <nav className="mt-16 border-t border-border pt-8">
          <div className="flex justify-between items-center">
            {newerPost ? (
              <Link
                href={`/posts/${newerPost.slug}`}
                className="flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-3 w-3" />
                {formatNavDate(newerPost.created_at)}
              </Link>
            ) : (
              <Link
                href="/"
                className="flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-3 w-3" />
                Home
              </Link>
            )}
            {olderPost && (
              <Link
                href={`/posts/${olderPost.slug}`}
                className="flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {formatNavDate(olderPost.created_at)}
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </nav>

        <Newsletter />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
            <a href="https://oh-so.com" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
              <img src="/oh-so-logo.svg" alt="OH-SO" className="h-9" />
            </a>
            <div className="flex gap-6 text-xs">
              <a href="https://www.linkedin.com/in/mattes/" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">
                LinkedIn
              </a>
              <a href="https://synthszr.com/en/sources" className="hover:text-accent transition-colors">
                Quellen
              </a>
              <a href="/impressum" className="hover:text-accent transition-colors">
                Impressum
              </a>
              <a href="/datenschutz" className="hover:text-accent transition-colors">
                Datenschutz
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
    </SwipeNavigation>
  )
}
