import Link from "next/link"
import { BlogHeader } from "@/components/blog-header"
import { FeaturedArticle } from "@/components/featured-article"
import { Newsletter } from "@/components/newsletter"
import { createClient } from "@/lib/supabase/server"

interface CombinedPost {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: Record<string, unknown>
  category: string
  created_at: string
  cover_image_url?: string | null
}

export default async function Page() {
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
    .select("id, title, slug, excerpt, content, category, created_at, cover_image_id")
    .eq("status", "published")
    .order("created_at", { ascending: false })

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

  // Parse AI posts content from JSON string if needed
  const parsedAiPosts: CombinedPost[] = (aiPosts || []).map(post => ({
    ...post,
    slug: post.slug || post.id,
    category: post.category || 'AI & Tech',
    content: typeof post.content === 'string' ? JSON.parse(post.content) : post.content,
    cover_image_url: post.cover_image_id ? coverImageMap.get(post.cover_image_id) : null
  }))

  // Combine and sort all posts
  const posts: CombinedPost[] = [
    ...(manualPosts || []),
    ...parsedAiPosts
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // Filter posts from the last 7 days (excluding featured)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
    })
  }

  const formatDateFull = (date: string) => {
    return new Date(date)
      .toLocaleDateString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .replace(/\//g, ".")
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
      {/* <BlogHeader /> */}

      <main className="mx-auto max-w-5xl px-6 py-12 md:py-20">
        <div className="mb-16 border-b border-border pb-8">
          <h1 className="text-4xl font-bold tracking-tight md:text-3xl lg:text-4xl">Synthszr</h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-sm">
            Feed the Soul. Run the System
          </p>
        </div>

        {featuredPost ? (
          <>
            <FeaturedArticle
              slug={featuredPost.slug}
              title={featuredPost.title}
              content={featuredPost.content}
              date={formatDateFull(featuredPost.created_at)}
              readTime={estimateReadTime(featuredPost.content)}
              category={featuredPost.category.toUpperCase()}
            />

            {/* Last 7 Days Headlines */}
            {recentPosts.length > 0 && (
              <section className="mt-12">
                <h3 className="mb-4 font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Letzte 7 Tage
                </h3>
                <div className="space-y-2 border-l-2 border-border pl-4">
                  {recentPosts.map((post) => (
                    <Link
                      key={post.id}
                      href={`/posts/${post.slug}`}
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
                href="/archive"
                className="inline-flex items-center gap-2 rounded border border-border px-4 py-2 font-mono text-xs transition-colors hover:bg-secondary"
              >
                Alle Artikel →
              </Link>
            </div>
          </>
        ) : (
          <div className="py-20 text-center">
            <p className="text-muted-foreground">No posts published yet.</p>
            <a href="/admin" className="mt-2 inline-block font-mono text-xs text-accent hover:underline">
              Go to Admin Panel →
            </a>
          </div>
        )}

        <Newsletter />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
            <a href="https://oh-so.com" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
              <img src="/oh-so-logo.svg" alt="OH-SO" className="h-6" />
            </a>
            <div className="flex gap-6 text-xs">
              <a href="https://www.linkedin.com/in/mattes/" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">
                LinkedIn
              </a>
              <a href="/impressum" className="hover:text-accent transition-colors">
                Impressum
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
