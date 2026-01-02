import { TiptapRenderer } from "./tiptap-renderer"

interface FeaturedArticleProps {
  slug: string
  title: string
  content: Record<string, unknown>
  date: string
  readTime: string
  category: string
  coverImageUrl?: string | null
}

export function FeaturedArticle({ slug, title, content, date, readTime, category, coverImageUrl }: FeaturedArticleProps) {
  return (
    <article className="mb-16 border-b border-border pb-16">
      <div className="mb-6">
        <span className="font-mono text-xs text-muted-foreground">LATEST</span>
      </div>

      {coverImageUrl && (
        <div className="mb-8 -mx-6 md:mx-0">
          {/* Centered Logo */}
          <div className="flex justify-center mb-4 px-6 md:px-0">
            <img
              src="/synthszr-logo.svg"
              alt="Synthszr"
              className="h-6 md:h-8 w-auto"
            />
          </div>
          {/* Cover Image */}
          <a href={`/posts/${slug}`} className="block md:rounded-lg overflow-hidden">
            <div
              className="relative aspect-[4/3] md:aspect-[21/9]"
              style={{
                backgroundColor: '#CCFF00',
                backgroundImage: `url(${coverImageUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
          </a>
        </div>
      )}

      <a href={`/posts/${slug}`} className="group">
        <h2 className="mb-6 text-3xl font-bold tracking-tight transition-colors group-hover:text-accent md:text-xl lg:text-2xl">
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
