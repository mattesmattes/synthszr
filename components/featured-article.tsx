import { TiptapRenderer } from "./tiptap-renderer"

interface FeaturedArticleProps {
  slug: string
  title: string
  content: Record<string, unknown>
  date: string
  readTime: string
  category: string
}

export function FeaturedArticle({ slug, title, content, date, readTime, category }: FeaturedArticleProps) {
  return (
    <article className="mb-16 border-b border-border pb-16">
      <div className="mb-6 flex items-center gap-4">
        <span className="rounded-sm bg-primary px-2 py-0.5 font-mono text-xs text-primary-foreground">{category}</span>
        <span className="font-mono text-xs text-muted-foreground">LATEST</span>
      </div>

      <a href={`/posts/${slug}`} className="group">
        <h2 className="mb-6 text-3xl font-bold tracking-tight transition-colors group-hover:text-accent md:text-4xl lg:text-5xl">
          {title}
        </h2>
      </a>

      <div className="mb-8 flex items-center gap-6 text-sm text-muted-foreground">
        <time dateTime={date} className="font-mono text-xs">
          {date}
        </time>
        <span className="font-mono text-xs">{readTime}</span>
      </div>

      <div className="prose-article">
        <TiptapRenderer content={content} />
      </div>

      <a href={`/posts/${slug}`} className="mt-8 inline-block font-mono text-xs text-accent hover:underline">
        Permalink →
      </a>
    </article>
  )
}
