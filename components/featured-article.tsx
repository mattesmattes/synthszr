import { Suspense } from "react"
import { PostContentView } from "./post-content-view"
import { AudioPlayer } from "./audio-player"
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
  queueItemIds?: string[] // For stable thumbnail matching
}

export function FeaturedArticle({
  slug,
  title,
  excerpt,
  content,
  createdAt,
  coverImageUrl,
  locale = 'de',
  postId,
  queueItemIds
}: FeaturedArticleProps) {
  const postUrl = `/${locale}/posts/${slug}`

  return (
    <article className="mb-16 border-b border-border pb-16">
      {coverImageUrl && (
        <div className="relative mb-8 rounded-lg overflow-hidden -mx-6">
          {/* Fixed 704px width for moiré-free dithering (1:2 of 1408px) */}
          {/* -mx-6 compensates for parent padding to allow full 704px width */}
          {/* Mobile: 704x704 (1:1 square), Desktop: 704x384 (11:6) */}
          <div
            className="relative flex flex-col items-center justify-center mx-auto w-[704px] max-w-[calc(100%+48px)] aspect-square md:aspect-[11/6] bg-neon-cyan"
          >
            {/* Clickable background */}
            <a href={postUrl} className="absolute inset-0 z-0">
              {/* Dithered PNG - pixelated rendering for sharp dithering pattern */}
              <img
                src={coverImageUrl}
                alt=""
                className="w-full h-full object-cover"
                style={{ imageRendering: 'pixelated' }}
              />
            </a>
            {/* Logo centered on top - w-full on mobile so img w-[70%] resolves against cover width */}
            <a href={postUrl} className="relative z-10 w-full flex justify-center md:w-auto">
              <img
                src="/synthszr-logo.svg"
                alt="Synthszr"
                className="h-auto w-[70%] max-w-[300px] md:h-24 md:w-auto md:max-w-[400px]"
              />
            </a>
            {/* Audio Player - directly under logo */}
            {postId && (
              <div className="relative z-10 mt-3">
                <Suspense fallback={null}>
                  <AudioPlayer postId={postId} locale={locale === 'de' ? 'de' : 'en'} />
                </Suspense>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mb-4">
        <span className="inline-block px-2 py-1 font-mono text-xs font-medium text-black bg-neon-yellow">
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
        <PostContentView content={content} postId={postId} queueItemIds={queueItemIds} />
      </div>

      <a href={postUrl} className="mt-8 inline-block font-mono text-xs text-accent hover:underline">
        Permalink →
      </a>
    </article>
  )
}
