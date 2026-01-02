import { notFound } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { BlogHeader } from "@/components/blog-header"
import { TiptapRenderer } from "@/components/tiptap-renderer"
import { ArrowLeft } from "lucide-react"

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
      .select("id, title, slug, excerpt, content, category, created_at, cover_image_id")
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
        cover_image_url: coverImageUrl
      } as PostData
    }
  }

  if (!post) {
    notFound()
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("de-DE", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* <BlogHeader /> */}

      <main className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to all posts
        </Link>

        <article>
          {/* Cover Image with neon-yellow background visible through transparent areas */}
          {post.cover_image_url && (
            <div className="mb-8 -mx-6 md:mx-0 md:rounded-lg overflow-hidden">
              <div
                className="relative aspect-[21/9]"
                style={{
                  backgroundColor: '#CCFF00',
                  backgroundImage: `url(${post.cover_image_url})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />
            </div>
          )}

          <header className="mb-12 border-b border-border pb-8">
            <div className="mb-4">
              <time className="font-mono text-xs text-muted-foreground">{formatDate(post.created_at)}</time>
            </div>
            <h1 className="text-3xl font-bold tracking-tight md:text-2xl">{post.title}</h1>
            {post.excerpt && <p className="mt-4 text-lg text-muted-foreground md:text-sm">{post.excerpt}</p>}
          </header>

          <div className="prose-headings:font-bold prose-headings:tracking-tight prose-h1:text-xl prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3 prose-p:mb-5 prose-blockquote:border-l-2 prose-blockquote:border-accent prose-blockquote:pl-6 prose-blockquote:italic">
            <TiptapRenderer content={post.content} />
          </div>
        </article>

        <footer className="mt-16 border-t border-border pt-8">
          <Link href="/" className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground">
            ← Back to Synthszr
          </Link>
        </footer>
      </main>
    </div>
  )
}
