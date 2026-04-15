'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { StockSynthszrLayer } from '@/components/stock-synthszr-layer'
import { PremarketSynthszrLayer } from '@/components/premarket-synthszr-layer'
import {
  RATING_BADGE_STYLES,
  RATING_LABELS,
} from '@/lib/synthszr/rating-styles'
import { trackEvent } from '@/lib/analytics/tracker'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/** Render markdown-style [text](url) links as clickable <a> tags */
function renderWithLinks(text: string): ReactNode {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/)
  return parts.map((part, i) => {
    const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (match) {
      return (
        <a key={i} href={match[2]} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:underline">
          {match[1]}
        </a>
      )
    }
    return part
  })
}

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
  keyTakeaways?: string[]
  rationale?: string | null
}

interface CompanyDetailClientProps {
  company: CompanyInfo
  articles: ArticleInfo[]
  locale?: string
  translations?: Record<string, string>
}

const defaultTranslations: Record<string, string> = {
  'companies.articles_count_singular': '{count} News erwähnt {company}',
  'companies.articles_count_plural': '{count} News erwähnen {company}',
  'companies.premarket_label': 'Pre-IPO Unternehmen',
}

export function CompanyDetailClient({ company, articles, locale, translations }: CompanyDetailClientProps) {
  const t = translations || defaultTranslations
  const [ratingData, setRatingData] = useState<RatingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showLayer, setShowLayer] = useState(false)

  useEffect(() => {
    async function fetchRating() {
      try {
        if (company.type === 'public') {
          const response = await fetch('/api/stock-synthszr/batch-ratings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: [company.slug] }),
          })
          const data = await response.json()
          if (data.ok && data.ratings?.[0]) {
            const r = data.ratings[0]
            setRatingData({
              rating: r.rating,
              keyTakeaways: r.keyTakeaways,
              rationale: r.rationale,
            })
          }
          const quoteResponse = await fetch('/api/stock-synthszr/batch-quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: [company.slug] }),
          })
          const quoteData = await quoteResponse.json()
          if (quoteData.ok && quoteData.quotes?.[0]) {
            const quote = quoteData.quotes[0]
            setRatingData(prev => prev ? {
              ...prev,
              ticker: quote.ticker,
              changePercent: quote.changePercent,
              direction: quote.direction,
            } : null)
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
              keyTakeaways: rating.keyTakeaways,
              rationale: rating.rationale,
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

  const handleAnalysisClick = () => {
    trackEvent('synthszr_analysis_click', { company: company.slug })
    setShowLayer(true)
  }

  const hasAnalysis = ratingData?.rating && (ratingData.keyTakeaways?.length || ratingData.rationale)
  const analysisLabel = company.type === 'premarket' ? 'Premarket-Synthszr' : 'Stock-Synthszr'

  return (
    <>
      {/* Header */}
      <div className="mb-8 border-b border-border pb-8">
        <h1 className="text-3xl font-bold tracking-tight">{company.name}</h1>
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

      {/* Analysis Summary Box */}
      {loading ? (
        <div className="mb-8 rounded-lg p-5 bg-[#ffffff] shadow-sm animate-pulse">
          <div className="h-5 w-40 bg-muted rounded mb-3" />
          <div className="space-y-2">
            <div className="h-4 w-full bg-muted rounded" />
            <div className="h-4 w-3/4 bg-muted rounded" />
          </div>
        </div>
      ) : hasAnalysis ? (
        <div className="mb-8 rounded-lg p-5 bg-[#ffffff] shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {analysisLabel}
            </span>
            {ratingData.rating && (
              <span className={cn(
                'text-xs font-bold px-2 py-0.5 rounded',
                RATING_BADGE_STYLES[ratingData.rating]
              )}>
                {RATING_LABELS[ratingData.rating]}
              </span>
            )}
          </div>

          {ratingData.keyTakeaways && ratingData.keyTakeaways.length > 0 && (
            <ul className="space-y-1.5 mb-3">
              {ratingData.keyTakeaways.map((takeaway, i) => (
                <li key={i} className="text-sm text-foreground flex gap-2">
                  <span className="text-muted-foreground shrink-0">•</span>
                  <span>{renderWithLinks(takeaway)}</span>
                </li>
              ))}
            </ul>
          )}

          {ratingData.rationale && (
            <p className="text-sm text-muted-foreground mb-3">
              <span className="font-semibold text-foreground">Vote:</span>{' '}
              {renderWithLinks(ratingData.rationale)}
            </p>
          )}

          <button
            onClick={handleAnalysisClick}
            className="inline-flex items-center gap-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-black/80 cursor-pointer"
          >
            Detailed analysis here →
          </button>
        </div>
      ) : null}

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

      {/* Analysis Layer */}
      {showLayer && company.type === 'public' && (
        <StockSynthszrLayer
          company={company.slug}
          onClose={() => setShowLayer(false)}
        />
      )}
      {showLayer && company.type === 'premarket' && (
        <PremarketSynthszrLayer
          company={company.slug}
          isin={ratingData?.isin}
          onClose={() => setShowLayer(false)}
        />
      )}
    </>
  )
}
