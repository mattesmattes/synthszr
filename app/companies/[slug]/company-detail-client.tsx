'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SynthszrBadge } from '@/components/synthszr-badge'

interface CompanyInfo {
  name: string
  slug: string
  type: 'public' | 'premarket'
}

interface PostInfo {
  id: string
  title: string
  slug: string | null
  excerpt: string | null
  created_at: string
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
  posts: PostInfo[]
}

/**
 * Client component for company detail page
 *
 * Fetches rating data and displays company header with rating badge,
 * followed by list of related posts.
 */
export function CompanyDetailClient({ company, posts }: CompanyDetailClientProps) {
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
          {posts.length} {posts.length === 1 ? 'Artikel erwähnt' : 'Artikel erwähnen'} {company.name}
        </p>
        {company.type === 'premarket' && (
          <p className="mt-1 text-xs text-muted-foreground">
            Pre-IPO Unternehmen
          </p>
        )}
      </div>

      {/* Posts List */}
      <div className="space-y-4">
        {posts.map((post) => (
          <Link
            key={post.id}
            href={`/posts/${post.slug || post.id}`}
            className="group block py-4 border-b border-border last:border-b-0 transition-colors hover:bg-muted/50 -mx-4 px-4 rounded"
          >
            <span className="font-mono text-xs text-muted-foreground">
              {formatDate(post.created_at)}
            </span>
            <h2 className="mt-1 text-base font-medium group-hover:text-accent group-hover:underline">
              {post.title}
            </h2>
            {post.excerpt && (
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                {post.excerpt}
              </p>
            )}
          </Link>
        ))}
      </div>
    </>
  )
}
