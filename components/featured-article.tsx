interface FeaturedArticleProps {
  slug: string
  title: string
  date: string
  createdAt: string
  readTime: string
  category: string
  coverImageUrl?: string | null
}

function formatDateWithWeekday(dateString: string): string {
  const d = new Date(dateString)
  const weekday = d.toLocaleDateString("de-DE", { weekday: "long" })
  const day = d.getDate().toString().padStart(2, '0')
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const year = d.getFullYear()
  return `Update vom ${weekday}, den ${day}.${month}.${year}`
}

export function FeaturedArticle({ slug, title, date, createdAt, readTime, category, coverImageUrl }: FeaturedArticleProps) {
  return (
    <article className="mb-16 border-b border-border pb-16">
      {coverImageUrl && (
        <a href={`/posts/${slug}`} className="block mb-8 -mx-6 md:mx-0 md:rounded-lg overflow-hidden">
          <div
            className="relative aspect-[4/3] md:aspect-[21/9] flex items-center justify-center"
            style={{
              backgroundColor: '#CCFF00',
              backgroundImage: `url(${coverImageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            <img
              src="/synthszr-logo.svg"
              alt="Synthszr"
              className="h-24 md:h-32 w-auto"
            />
          </div>
        </a>
      )}

      <div className="mb-4">
        <span className="inline-block px-2 py-1 font-mono text-xs font-medium text-black" style={{ backgroundColor: '#CCFF00' }}>
          {formatDateWithWeekday(createdAt)}
        </span>
      </div>

      <a href={`/posts/${slug}`} className="group">
        <h2 className="mb-6 text-3xl font-bold tracking-tight transition-colors group-hover:text-accent md:text-xl lg:text-2xl">
          {title}
        </h2>
      </a>

      <a href={`/posts/${slug}`} className="inline-block font-mono text-xs text-accent hover:underline">
        Artikel lesen →
      </a>
    </article>
  )
}
