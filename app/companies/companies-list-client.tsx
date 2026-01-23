'use client'

import { useEffect, useState, useMemo } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { CompanyTableRow, CompanyCardData, CompanyTableSkeleton } from '@/components/company-table-row'
import { cn } from '@/lib/utils'

interface CompanyData {
  name: string
  slug: string
  type: 'public' | 'premarket'
  mentionCount: number
}

interface BatchQuoteResult {
  company: string
  displayName: string
  ticker: string | null
  changePercent: number | null
  direction: 'up' | 'down' | 'neutral' | null
  rating: 'BUY' | 'HOLD' | 'SELL' | null
}

interface PremarketRatingResult {
  company: string
  rating: 'BUY' | 'HOLD' | 'SELL' | null
  isin?: string
}

interface CompaniesListClientProps {
  companies: CompanyData[]
  locale?: string
  translations?: Record<string, string>
}

type SortColumn = 'name' | 'ticker' | 'vote' | 'articles'
type SortDirection = 'asc' | 'desc'

const headerTranslations: Record<string, { company: string; ticker: string; vote: string; articles: string }> = {
  de: { company: 'Unternehmen', ticker: 'Ticker', vote: 'Synthszr Vote', articles: 'Artikel' },
  en: { company: 'Company', ticker: 'Ticker', vote: 'Synthszr Vote', articles: 'Articles' },
  nds: { company: 'Ünnernehmen', ticker: 'Ticker', vote: 'Synthszr Vote', articles: 'Artikels' },
  cs: { company: 'Společnost', ticker: 'Ticker', vote: 'Synthszr Vote', articles: 'Články' },
}

// Rating sort order: BUY > HOLD > SELL > null
const ratingOrder: Record<string, number> = { BUY: 3, HOLD: 2, SELL: 1 }

/**
 * Client component that fetches ratings and displays company cards
 *
 * Batch-fetches ratings for all companies on mount, then displays cards
 * with the enriched data.
 */
export function CompaniesListClient({ companies, locale }: CompaniesListClientProps) {
  const [enrichedCompanies, setEnrichedCompanies] = useState<CompanyCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [sortColumn, setSortColumn] = useState<SortColumn>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  // Sort companies based on current sort state
  const sortedCompanies = useMemo(() => {
    const sorted = [...enrichedCompanies].sort((a, b) => {
      let comparison = 0

      switch (sortColumn) {
        case 'name':
          comparison = a.name.localeCompare(b.name, 'de')
          break
        case 'ticker':
          // Sort by performance (changePercent), null values last
          const perfA = a.changePercent ?? null
          const perfB = b.changePercent ?? null
          if (perfA === null && perfB === null) comparison = 0
          else if (perfA === null) comparison = 1
          else if (perfB === null) comparison = -1
          else comparison = perfB - perfA // Higher performance first by default
          break
        case 'vote':
          // Sort by rating: BUY > HOLD > SELL > null
          const ratingA = a.rating ? ratingOrder[a.rating] : 0
          const ratingB = b.rating ? ratingOrder[b.rating] : 0
          comparison = ratingB - ratingA // Higher rating first by default
          break
        case 'articles':
          comparison = b.mentionCount - a.mentionCount // More articles first by default
          break
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })

    return sorted
  }, [enrichedCompanies, sortColumn, sortDirection])

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      // New column: set default direction
      setSortColumn(column)
      setSortDirection(column === 'vote' || column === 'articles' || column === 'ticker' ? 'desc' : 'asc')
    }
  }

  const SortIcon = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) return null
    return sortDirection === 'asc'
      ? <ChevronUp className="inline h-3 w-3 ml-1" />
      : <ChevronDown className="inline h-3 w-3 ml-1" />
  }

  useEffect(() => {
    async function fetchRatings() {
      try {
        // Separate public and premarket companies
        const publicCompanies = companies.filter(c => c.type === 'public')
        const premarketCompanies = companies.filter(c => c.type === 'premarket')

        // Chunk public companies into batches of 20 (API limit)
        const BATCH_SIZE = 20
        const publicChunks: string[][] = []
        for (let i = 0; i < publicCompanies.length; i += BATCH_SIZE) {
          publicChunks.push(publicCompanies.slice(i, i + BATCH_SIZE).map(c => c.slug))
        }

        // Fetch all public company chunks in parallel
        const publicResponses = await Promise.all(
          publicChunks.map(chunk =>
            fetch('/api/stock-synthszr/batch-quotes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ companies: chunk }),
            }).then(r => r.json())
          )
        )

        // Fetch premarket ratings
        const premarketResponse = premarketCompanies.length > 0
          ? await fetch('/api/premarket/batch-ratings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ companies: premarketCompanies.map(c => c.slug) }),
            }).then(r => r.json())
          : { ok: true, ratings: [] }

        // Combine all public quotes from all chunks
        const allPublicQuotes: BatchQuoteResult[] = publicResponses
          .filter(r => r.ok)
          .flatMap(r => r.quotes || [])

        // Build lookup maps
        const publicQuotesMap = new Map<string, BatchQuoteResult>(
          allPublicQuotes.map((r: BatchQuoteResult) => [r.company.toLowerCase(), r])
        )

        const premarketRatingsMap = new Map<string, PremarketRatingResult>(
          (premarketResponse.ok && premarketResponse.ratings || [])
            .map((r: PremarketRatingResult) => [r.company.toLowerCase(), r])
        )

        // Enrich companies with rating data
        const enriched: CompanyCardData[] = companies.map(company => {
          if (company.type === 'public') {
            const quoteData = publicQuotesMap.get(company.slug.toLowerCase())
            return {
              ...company,
              rating: quoteData?.rating ?? null,
              ticker: quoteData?.ticker ?? null,
              changePercent: quoteData?.changePercent ?? null,
              direction: quoteData?.direction ?? null,
            }
          } else {
            const ratingData = premarketRatingsMap.get(company.slug.toLowerCase())
            return {
              ...company,
              rating: ratingData?.rating ?? null,
              isin: ratingData?.isin,
            }
          }
        })

        setEnrichedCompanies(enriched)
      } catch (error) {
        console.error('[companies] Failed to fetch ratings:', error)
        // Still show companies without ratings
        setEnrichedCompanies(companies.map(c => ({ ...c, rating: null })))
      } finally {
        setLoading(false)
      }
    }

    fetchRatings()
  }, [companies])

  const t = headerTranslations[locale || 'de'] || headerTranslations.de

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-background overflow-hidden">
        <table className="w-full">
          <thead className="sticky top-0 bg-muted/50 backdrop-blur-sm z-10">
            <tr className="border-b border-border">
              <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.company}</th>
              <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.ticker}</th>
              <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.vote}</th>
              <th className="text-right py-3 px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.articles}</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }).map((_, i) => (
              <CompanyTableSkeleton key={i} />
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const headerClass = "text-left py-3 px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none"

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      <table className="w-full">
        <thead className="sticky top-0 bg-muted/50 backdrop-blur-sm z-10">
          <tr className="border-b border-border">
            <th className={headerClass} onClick={() => handleSort('name')}>
              {t.company}<SortIcon column="name" />
            </th>
            <th className={headerClass} onClick={() => handleSort('ticker')}>
              {t.ticker}<SortIcon column="ticker" />
            </th>
            <th className={headerClass} onClick={() => handleSort('vote')}>
              {t.vote}<SortIcon column="vote" />
            </th>
            <th className={cn(headerClass, "text-right")} onClick={() => handleSort('articles')}>
              {t.articles}<SortIcon column="articles" />
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedCompanies.map(company => (
            <CompanyTableRow key={company.slug} company={company} locale={locale} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
