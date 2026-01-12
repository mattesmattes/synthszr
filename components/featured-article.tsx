import { TiptapRenderer } from "./tiptap-renderer"
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
}

function formatDateWithWeekday(dateString: string, locale: LanguageCode = 'de'): string {
  const d = new Date(dateString)
  const localeStr = locale === 'de' ? 'de-DE' : locale
  const weekday = d.toLocaleDateString(localeStr, { weekday: "long" })
  const day = d.getDate().toString().padStart(2, '0')
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const year = d.getFullYear()
  return `${weekday}, der ${day}.${month}.${year}`
}

export function FeaturedArticle({
  slug,
  title,
  excerpt,
  content,
  createdAt,
  coverImageUrl,
  locale = 'de'
}: FeaturedArticleProps) {
  const postUrl = `/${locale}/posts/${slug}`

  return (
    <article className="mb-16 border-b border-border pb-16">
      {coverImageUrl && (
        <a href={postUrl} className="block mb-8 -mx-6 md:mx-0 md:rounded-lg overflow-hidden">
          <div
            className="relative aspect-[4/3] md:aspect-[21/9] flex items-center justify-center"
            style={{ backgroundColor: '#CCFF00' }}
          >
            {/* Dithered PNG with transparent pixels - yellow background shows through */}
            <img
              src={coverImageUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Logo centered on top */}
            <img
              src="/synthszr-logo.svg"
              alt="Synthszr"
              className="relative z-10 h-24 md:h-32 w-auto"
            />
          </div>
        </a>
      )}

      <div className="mb-4">
        <span className="inline-block px-2 py-1 font-mono text-xs font-medium text-black" style={{ backgroundColor: '#CCFF00' }}>
          {formatDateWithWeekday(createdAt, locale)}
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
        <TiptapRenderer content={content} />
      </div>

      <a href={postUrl} className="mt-8 inline-block font-mono text-xs text-accent hover:underline">
        Permalink →
      </a>
    </article>
  )
}
