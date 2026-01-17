'use client'

import { useEffect, useState } from 'react'
import { CompanyCard, CompanyCardData, CompanyCardSkeleton } from '@/components/company-card'

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
}

/**
 * Client component that fetches ratings and displays company cards
 *
 * Batch-fetches ratings for all companies on mount, then displays cards
 * with the enriched data.
 */
export function CompaniesListClient({ companies }: CompaniesListClientProps) {
  const [enrichedCompanies, setEnrichedCompanies] = useState<CompanyCardData[]>([])
  const [loading, setLoading] = useState(true)

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

  // Group companies alphabetically
  const groupedCompanies = enrichedCompanies.reduce((acc, company) => {
    const letter = company.name.charAt(0).toUpperCase()
    if (!acc[letter]) {
      acc[letter] = []
    }
    acc[letter].push(company)
    return acc
  }, {} as Record<string, CompanyCardData[]>)

  const sortedLetters = Object.keys(groupedCompanies).sort((a, b) => a.localeCompare(b, 'de'))

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <CompanyCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {sortedLetters.map(letter => (
        <section key={letter}>
          <h2 className="mb-3 font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {letter}
          </h2>
          <div className="rounded-lg border border-border bg-background p-4">
            {groupedCompanies[letter].map(company => (
              <CompanyCard key={company.slug} company={company} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
