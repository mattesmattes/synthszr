'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SynthszrBadge } from '@/components/synthszr-badge'

interface CompanyInfo {
  name: string
  slug: string
  type: 'public' | 'premarket'
}

interface ArticleInfo {
  postId: string
  postSlug: string
  postCreatedAt: string
  articleIndex: number
  headline: string
  excerpt: string
}

interface RatingData {
  rating: 'BUY' | 'HOLD' | 'SELL' | null
  ticker?: string | null
  changePercent?: number | null
  direction?: 'up' | 'down' | 'neutral' | null
  isin?: string
}

interface CompanyDetailClientProps {
  company: CompanyInfo
  articles: ArticleInfo[]
  locale?: string
  translations?: Record<string, string>
}

/**
 * Client component for company detail page
 *
 * Fetches rating data and displays company header with rating badge,
 * followed by list of related articles (H2 sections within posts).
 */
const defaultTranslations: Record<string, string> = {
  'companies.articles_count_singular': '{count} News erwähnt {company}',
  'companies.articles_count_plural': '{count} News erwähnen {company}',
  'companies.premarket_label': 'Pre-IPO Unternehmen',
}

export function CompanyDetailClient({ company, articles, locale, translations }: CompanyDetailClientProps) {
  const t = translations || defaultTranslations
  const [ratingData, setRatingData] = useState<RatingData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchRating() {
      try {
        if (company.type === 'public') {
          const response = await fetch('/api/stock-synthszr/batch-quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: [company.slug] }),
          })
          const data = await response.json()
          if (data.ok && data.quotes?.[0]) {
            const quote = data.quotes[0]
            setRatingData({
              rating: quote.rating,
              ticker: quote.ticker,
              changePercent: quote.changePercent,
              direction: quote.direction,
            })
          }
        } else {
          const response = await fetch('/api/premarket/batch-ratings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: [company.slug] }),
          })
          const data = await response.json()
          if (data.ok && data.ratings?.[0]) {
            const rating = data.ratings[0]
            setRatingData({
              rating: rating.rating,
              isin: rating.isin,
            })
          }
        }
      } catch (error) {
        console.error('[company-detail] Failed to fetch rating:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchRating()
  }, [company.slug, company.type])

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  return (
    <>
      {/* Header */}
      <div className="mb-12 border-b border-border pb-8">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-3xl font-bold tracking-tight">{company.name}</h1>
          {loading ? (
            <div className="h-6 w-12 bg-muted animate-pulse rounded" />
          ) : ratingData?.rating ? (
            <SynthszrBadge
              company={company.slug}
              displayName={company.name}
              rating={ratingData.rating}
              type={company.type}
              ticker={ratingData.ticker}
              changePercent={ratingData.changePercent}
              direction={ratingData.direction}
              isin={ratingData.isin}
              showName={false}
              size="md"
            />
          ) : null}
        </div>
        <p className="mt-2 text-muted-foreground">
          {articles.length === 1
            ? t['companies.articles_count_singular'].replace('{count}', '1').replace('{company}', company.name)
            : t['companies.articles_count_plural'].replace('{count}', String(articles.length)).replace('{company}', company.name)
          }
        </p>
        {company.type === 'premarket' && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t['companies.premarket_label']}
          </p>
        )}
      </div>

      {/* Articles List */}
      <div className="space-y-4">
        {articles.map((article, idx) => (
          <Link
            key={`${article.postId}-${article.articleIndex}-${idx}`}
            href={locale ? `/${locale}/posts/${article.postSlug}#article-${article.articleIndex}` : `/posts/${article.postSlug}#article-${article.articleIndex}`}
            className="group block py-4 border-b border-border last:border-b-0 transition-colors hover:bg-muted/50 -mx-4 px-4 rounded"
          >
            <span className="font-mono text-xs text-muted-foreground">
              {formatDate(article.postCreatedAt)}
            </span>
            <h2 className="mt-1 text-base font-medium group-hover:text-accent group-hover:underline">
              {article.headline}
            </h2>
            {article.excerpt && (
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                {article.excerpt}
              </p>
            )}
          </Link>
        ))}
      </div>
    </>
  )
}
