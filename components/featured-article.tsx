import { TiptapRenderer } from "./tiptap-renderer"
import { formatUpdateDate } from "@/lib/i18n/config"
import type { LanguageCode } from "@/lib/types"

interface FeaturedArticleProps {
  slug: string
  title: string
  excerpt?: string | null
  content: Record<string, unknown>
  date: string
  createdAt: string
  readTime: string
  category: string
  coverImageUrl?: string | null
  locale?: LanguageCode
  postId?: string // For article thumbnails
}

export function FeaturedArticle({
  slug,
  title,
  excerpt,
  content,
  createdAt,
  coverImageUrl,
  locale = 'de',
  postId
}: FeaturedArticleProps) {
  const postUrl = `/${locale}/posts/${slug}`

  return (
    <article className="mb-16 border-b border-border pb-16">
      {coverImageUrl && (
        <a href={postUrl} className="block mb-8 rounded-lg overflow-hidden -mx-6">
          {/* Fixed 704px width for moiré-free dithering (1:2 of 1408px) */}
          {/* -mx-6 compensates for parent padding to allow full 704px width */}
          {/* Mobile: 704x704 (1:1 square), Desktop: 704x384 (11:6) */}
          <div
            className="relative flex items-center justify-center mx-auto w-[704px] max-w-[calc(100%+48px)] aspect-square md:aspect-[11/6]"
            style={{ backgroundColor: '#CCFF00' }}
          >
            {/* Dithered PNG - pixelated rendering for sharp dithering pattern */}
            <img
              src={coverImageUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{ imageRendering: 'pixelated' }}
            />
            {/* Logo centered on top */}
            <img
              src="/synthszr-logo.svg"
              alt="Synthszr"
              className="relative z-10 h-20 md:h-24 w-auto max-w-[80%]"
            />
          </div>
        </a>
      )}

      <div className="mb-4">
        <span className="inline-block px-2 py-1 font-mono text-xs font-medium text-black" style={{ backgroundColor: '#CCFF00' }}>
          {formatUpdateDate(createdAt, locale)}
        </span>
      </div>

      <a href={postUrl} className="group">
        <h2 className="mb-3 text-3xl font-bold tracking-tight transition-colors group-hover:text-accent md:text-xl lg:text-2xl">
          {title}
        </h2>
      </a>

      {excerpt && (
        <p className="mb-6 text-lg text-muted-foreground leading-relaxed">
          {excerpt}
        </p>
      )}

      <div className="prose-article">
        <TiptapRenderer content={content} postId={postId} />
      </div>

      <a href={postUrl} className="mt-8 inline-block font-mono text-xs text-accent hover:underline">
        Permalink →
      </a>
    </article>
  )
}
