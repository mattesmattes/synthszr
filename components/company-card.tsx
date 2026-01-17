'use client'

import Link from 'next/link'
import { SynthszrBadge } from './synthszr-badge'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type Rating = 'BUY' | 'HOLD' | 'SELL'

export interface CompanyCardData {
  name: string
  slug: string
  type: 'public' | 'premarket'
  mentionCount: number
  // Rating data (fetched separately)
  rating?: Rating | null
  ticker?: string | null
  changePercent?: number | null
  direction?: 'up' | 'down' | 'neutral' | null
  isin?: string
}

interface CompanyCardProps {
  company: CompanyCardData
  className?: string
}

/**
 * Card component for displaying a company in the companies list
 *
 * Shows: Company name, ticker, percentage change, rating badge, news count link
 */
export function CompanyCard({ company, className }: CompanyCardProps) {
  const hasRating = company.rating != null

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 py-3 border-b border-border last:border-b-0',
        className
      )}
    >
      {/* Left side: Company info + badge */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {hasRating ? (
          <SynthszrBadge
            company={company.slug}
            displayName={company.name}
            rating={company.rating!}
            type={company.type}
            ticker={company.ticker}
            changePercent={company.changePercent}
            direction={company.direction}
            isin={company.isin}
            showName={true}
            size="md"
          />
        ) : (
          <span className="text-sm font-medium truncate">
            {company.name}
            {company.type === 'premarket' && (
              <span className="ml-1 text-xs text-muted-foreground">(Premarket)</span>
            )}
          </span>
        )}
      </div>

      {/* Right side: News count link */}
      <Link
        href={`/companies/${company.slug}`}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
      >
        <span>{company.mentionCount} {company.mentionCount === 1 ? 'Artikel' : 'Artikel'}</span>
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  )
}

/**
 * Skeleton loader for CompanyCard
 */
export function CompanyCardSkeleton() {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border">
      <div className="flex items-center gap-3">
        <div className="h-4 w-24 bg-muted animate-pulse rounded" />
        <div className="h-5 w-10 bg-muted animate-pulse rounded" />
      </div>
      <div className="h-4 w-16 bg-muted animate-pulse rounded" />
    </div>
  )
}
