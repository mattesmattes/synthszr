import { BlogHeader } from "@/components/blog-header"
import { BlogPost } from "@/components/blog-post"
import { FeaturedArticle } from "@/components/featured-article"
import { Newsletter } from "@/components/newsletter"
import { createClient } from "@/lib/supabase/server"
import type { Post } from "@/lib/types"

export default async function Page() {
  const supabase = await createClient()
  const { data: posts } = await supabase
    .from("posts")
    .select("*")
    .eq("published", true)
    .order("created_at", { ascending: false })

  const estimateReadTime = (content: Record<string, unknown>) => {
    const text = JSON.stringify(content)
    const words = text.split(/\s+/).length
    const minutes = Math.ceil(words / 200)
    return `${minutes} min`
  }

  const formatDate = (date: string) => {
    return new Date(date)
      .toLocaleDateString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .replace(/\//g, ".")
  }

  const featuredPost = posts && posts.length > 0 ? posts[0] : null
  const olderPosts = posts && posts.length > 1 ? posts.slice(1) : []

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BlogHeader />

      <main className="mx-auto max-w-5xl px-6 py-12 md:py-20">
        <div className="mb-16 border-b border-border pb-8">
          <h1 className="text-4xl font-bold tracking-tight md:text-6xl lg:text-7xl">Synthszr</h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            Digital synthesis, minimal design, and the architecture of sound
          </p>
        </div>

        {featuredPost ? (
          <>
            <FeaturedArticle
              slug={featuredPost.slug}
              title={featuredPost.title}
              content={featuredPost.content}
              date={formatDate(featuredPost.created_at)}
              readTime={estimateReadTime(featuredPost.content)}
              category={featuredPost.category.toUpperCase()}
            />

            {olderPosts.length > 0 && (
              <section>
                <h3 className="mb-6 font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Archive
                </h3>
                <div className="space-y-1">
                  {olderPosts.map((post: Post, index: number) => (
                    <BlogPost
                      key={post.id}
                      id={String(index + 1).padStart(2, "0")}
                      slug={post.slug}
                      title={post.title}
                      excerpt={post.excerpt || ""}
                      date={formatDate(post.created_at)}
                      readTime={estimateReadTime(post.content)}
                      category={post.category.toUpperCase()}
                    />
                  ))}
                </div>
              </section>
            )}
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
          <div className="flex flex-col gap-8 md:flex-row md:justify-between">
            <div>
              <h3 className="font-mono text-sm font-bold">Synthszr</h3>
              <p className="mt-2 text-sm text-muted-foreground">© 2025 All rights reserved</p>
            </div>
            <div className="flex gap-12">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Connect</h4>
                <ul className="mt-3 space-y-2 text-sm">
                  <li>
                    <a href="#" className="hover:text-accent transition-colors">
                      Twitter
                    </a>
                  </li>
                  <li>
                    <a href="#" className="hover:text-accent transition-colors">
                      GitHub
                    </a>
                  </li>
                  <li>
                    <a href="#" className="hover:text-accent transition-colors">
                      Discord
                    </a>
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Links</h4>
                <ul className="mt-3 space-y-2 text-sm">
                  <li>
                    <a href="/admin" className="hover:text-accent transition-colors">
                      Admin
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
