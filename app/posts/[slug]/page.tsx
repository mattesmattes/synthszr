import { notFound } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { BlogHeader } from "@/components/blog-header"
import { TiptapRenderer } from "@/components/tiptap-renderer"
import { ArrowLeft } from "lucide-react"

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: post } = await supabase.from("posts").select("*").eq("slug", slug).eq("published", true).single()

  if (!post) {
    notFound()
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BlogHeader />

      <main className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to all posts
        </Link>

        <article>
          <header className="mb-12 border-b border-border pb-8">
            <div className="mb-4 flex items-center gap-4">
              <span className="rounded-sm bg-primary px-2 py-0.5 font-mono text-xs text-primary-foreground">
                {post.category.toUpperCase()}
              </span>
              <time className="font-mono text-xs text-muted-foreground">{formatDate(post.created_at)}</time>
            </div>
            <h1 className="text-4xl font-bold tracking-tight md:text-5xl">{post.title}</h1>
            {post.excerpt && <p className="mt-4 text-xl text-muted-foreground">{post.excerpt}</p>}
          </header>

          <div className="prose-headings:font-bold prose-headings:tracking-tight prose-h1:text-3xl prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-p:mb-6 prose-blockquote:border-l-2 prose-blockquote:border-accent prose-blockquote:pl-6 prose-blockquote:italic">
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
