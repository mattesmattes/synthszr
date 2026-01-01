interface BlogPostProps {
  id: string
  slug: string
  title: string
  excerpt: string
  date: string
  readTime: string
  category: string
}

export function BlogPost({ id, slug, title, excerpt, date, readTime, category }: BlogPostProps) {
  return (
    <article className="group border-b border-border transition-colors hover:bg-secondary/50">
      <a href={`/posts/${slug}`} className="block px-4 py-8 md:px-6 md:py-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex-1">
            <div className="mb-3 flex items-center gap-4">
              <span className="font-mono text-xs text-muted-foreground">{id}</span>
              <span className="rounded-sm bg-primary px-2 py-0.5 font-mono text-xs text-primary-foreground">
                {category}
              </span>
            </div>
            <h2 className="mb-2 text-2xl font-bold tracking-tight md:text-lg">{title}</h2>
            <p className="text-sm text-muted-foreground">{excerpt}</p>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground md:flex-col md:items-end md:gap-2">
            <time dateTime={date} className="font-mono text-xs">
              {date}
            </time>
            <span className="font-mono text-xs">{readTime}</span>
          </div>
        </div>
      </a>
    </article>
  )
}
