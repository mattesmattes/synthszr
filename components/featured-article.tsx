import { Suspense } from "react"
import ReactDOM from "react-dom"
import { PostContentView } from "./post-content-view"
import { AudioPlayer } from "./audio-player"
import { PodcastBadges } from "./podcast-badges"
import { CoverCalligram } from "./cover-calligram"
import { formatUpdateDate } from "@/lib/i18n/config"
import type { LanguageCode } from "@/lib/types"
import type { CoverAnimationConfig } from "@/lib/types/cover-animation"

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
  desktopCoverUrl?: string | null
  locale?: LanguageCode
  postId?: string // For article thumbnails
  queueItemIds?: string[] // For stable thumbnail matching
  coverAnimation?: CoverAnimationConfig
}

export function FeaturedArticle({
  slug,
  title,
  excerpt,
  content,
  createdAt,
  coverImageUrl,
  desktopCoverUrl,
  locale = 'de',
  postId,
  queueItemIds,
  coverAnimation,
}: FeaturedArticleProps) {
  const postUrl = `/${locale}/posts/${slug}`

  // Preload the LCP cover so the browser starts the image request before the
  // HTML parser reaches the <img>. Closes the "LCP request discovery" gap that
  // PageSpeed flagged. Mobile-first: mobile preload covers the most-tested
  // form factor; desktop falls back to the picture-source fetch.
  if (coverImageUrl) {
    ReactDOM.preload(coverImageUrl, { as: "image", fetchPriority: "high" })
  }

  return (
    <article className="mb-16 border-b border-border pb-16">
      {coverImageUrl && (
        <div className="relative mb-8 overflow-hidden -mx-6">
          {/* Fixed 704px width for moiré-free dithering (1:2 of 1408px) */}
          {/* -mx-6 compensates for parent padding to allow full 704px width */}
          {/* Mobile: 704x704 (1:1 square), Desktop: 704x384 (11:6) */}
          <div
            className="relative flex flex-col items-center justify-center mx-auto w-[704px] max-w-full aspect-[16/9] md:aspect-[11/6] bg-neon-cyan"
          >
            {/* Clickable background */}
            <a href={postUrl} className="absolute inset-0 z-0">
              <picture className="block w-full h-full">
                {desktopCoverUrl && (
                  <source media="(min-width: 768px)" srcSet={desktopCoverUrl} />
                )}
                <img
                  src={coverImageUrl}
                  alt={title}
                  width={1408}
                  height={1408}
                  className="w-full h-full object-cover"
                  fetchPriority="high"
                  decoding="async"
                />
              </picture>
            </a>
            {/* Logo centered on top - w-full on mobile so percentage resolves against cover width */}
            <a href={postUrl} className="relative z-10 w-full flex justify-center md:w-auto">
              {coverAnimation?.mode === 'calligram' ? (
                <CoverCalligram {...coverAnimation.calligram} />
              ) : (
                <img
                  src="/synthszr-logo.svg"
                  alt="Synthszr"
                  width={400}
                  height={96}
                  className="h-auto w-[80%] md:h-24 md:w-auto md:max-w-[400px]"
                  decoding="async"
                />
              )}
            </a>
          </div>
          <PodcastBadges>
            {postId && (
              <Suspense fallback={null}>
                <AudioPlayer postId={postId} locale={locale === 'de' ? 'de' : 'en'} />
              </Suspense>
            )}
          </PodcastBadges>
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
        excerpt.includes('•') ? (
          <ul className="mb-6 space-y-1 text-lg text-muted-foreground leading-relaxed list-none pl-0">
            {excerpt.split('\n').filter(l => l.trim().startsWith('•')).map((line, i) => (
              <li key={i}>{line.trim()}</li>
            ))}
          </ul>
        ) : (
          <p className="mb-6 text-lg text-muted-foreground leading-relaxed">
            {excerpt}
          </p>
        )
      )}

      <div className="prose-article">
        <PostContentView content={content} postId={postId} queueItemIds={queueItemIds} />
      </div>

    </article>
  )
}
