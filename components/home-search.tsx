'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Search, Loader2, Building2, FileText } from 'lucide-react'
import { StockSynthszrLayer } from './stock-synthszr-layer'

interface PostHit {
  id: string
  title: string
  slug: string
  excerpt: string | null
  snippet: string | null
  type: 'manual' | 'ai'
}

interface CompanyHit {
  name: string
  slug: string
  type: 'public' | 'premarket'
}

interface SearchResults {
  posts: PostHit[]
  companies: CompanyHit[]
}

type Vote = 'BUY' | 'HOLD' | 'SELL' | null

interface CompanyRating {
  rating: Vote
  ticker: string | null
  changePercent: number | null
  direction: 'up' | 'down' | 'neutral' | null
}

const VOTE_COLOR: Record<Exclude<Vote, null>, string> = {
  BUY: 'bg-[#39FF14] text-black',
  HOLD: 'bg-[#00FFFF] text-black',
  SELL: 'bg-[#FF6600] text-black',
}

const DEBOUNCE_MS = 250

interface HomeSearchProps {
  locale?: string
}

interface SearchStrings {
  placeholder: string
  postsHeading: (n: number) => string
  companiesHeading: (n: number) => string
  noResults: (q: string) => string
}

const STRINGS: Record<string, SearchStrings> = {
  de: {
    placeholder: 'Suche im Blog Content oder nach Unternehmen…',
    postsHeading: (n) => `Blogposts (${n})`,
    companiesHeading: (n) => `Unternehmen (${n}) — Synthszr-Analyse`,
    noResults: (q) => `Keine Treffer für „${q}".`,
  },
  en: {
    placeholder: 'Search blog content or companies…',
    postsHeading: (n) => `Blog posts (${n})`,
    companiesHeading: (n) => `Companies (${n}) — Synthszr analysis`,
    noResults: (q) => `No results for "${q}".`,
  },
  cs: {
    placeholder: 'Hledat v obsahu blogu nebo firmách…',
    postsHeading: (n) => `Blogové příspěvky (${n})`,
    companiesHeading: (n) => `Firmy (${n}) — Synthszr analýza`,
    noResults: (q) => `Žádné výsledky pro „${q}".`,
  },
  nds: {
    placeholder: 'Söök in’n Blog oder na Firmen…',
    postsHeading: (n) => `Blog-Bidrägen (${n})`,
    companiesHeading: (n) => `Firmen (${n}) — Synthszr-Analyse`,
    noResults: (q) => `Keen Drepper för „${q}".`,
  },
}

function getStrings(locale: string): SearchStrings {
  return STRINGS[locale] || STRINGS.en
}

/**
 * Wraps each match of `query` inside `text` with a <mark> element so
 * the dropdown shows where the match is. Falls back to plain text if
 * the query is empty or has no match.
 */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim()
  if (!trimmed) return <>{text}</>
  // Escape regex metacharacters in the query
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(regex)
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-neon-cyan/60 text-foreground rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

export function HomeSearch({ locale = 'de' }: HomeSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [openCompany, setOpenCompany] = useState<CompanyHit | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // In-memory LRU-ish cache keyed by `${locale}:${query}`. Avoids
  // re-fetching when the user clears + retypes the same word, or
  // pastes the same query twice within a session.
  const cacheRef = useRef<Map<string, SearchResults>>(new Map())
  // Lazy-loaded vote/quote per company. Keyed by lowercase company name.
  // Hydrated after the search results land so the dropdown shows up
  // immediately and the vote badges fade in afterwards.
  const [ratings, setRatings] = useState<Map<string, CompanyRating>>(new Map())
  const ratingsCacheRef = useRef<Map<string, CompanyRating>>(new Map())
  const strings = getStrings(locale)

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null)
      setLoading(false)
      return
    }

    const handle = setTimeout(async () => {
      const trimmed = query.trim()
      const cacheKey = `${locale}:${trimmed.toLowerCase()}`

      // Hit the cache first — instant for repeat queries.
      const cached = cacheRef.current.get(cacheKey)
      if (cached) {
        setResults(cached)
        setLoading(false)
        return
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&locale=${encodeURIComponent(locale)}`, {
          signal: controller.signal,
        })
        if (res.ok) {
          const data = (await res.json()) as SearchResults
          setResults(data)
          // Cache up to 50 queries; drop the oldest (insertion order).
          cacheRef.current.set(cacheKey, data)
          if (cacheRef.current.size > 50) {
            const firstKey = cacheRef.current.keys().next().value
            if (firstKey !== undefined) cacheRef.current.delete(firstKey)
          }
        }
      } catch (err) {
        // Aborted requests throw; ignore them
        if ((err as Error).name !== 'AbortError') console.error('[Search]', err)
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(handle)
  }, [query])

  // Async hydration of company ratings/quotes. Runs whenever new
  // search results contain companies. Cached per company name so
  // repeat queries don't re-fetch.
  useEffect(() => {
    if (!results || results.companies.length === 0) return

    // Apply any already-cached ratings synchronously
    const initial = new Map<string, CompanyRating>()
    for (const c of results.companies) {
      const cached = ratingsCacheRef.current.get(c.name.toLowerCase())
      if (cached) initial.set(c.name.toLowerCase(), cached)
    }
    if (initial.size > 0) setRatings((prev) => new Map([...prev, ...initial]))

    const missing = results.companies.filter(
      (c) => !ratingsCacheRef.current.has(c.name.toLowerCase())
    )
    if (missing.length === 0) return

    const publics = missing.filter((c) => c.type === 'public').map((c) => c.name)
    const premarkets = missing.filter((c) => c.type === 'premarket').map((c) => c.name)

    const aborter = new AbortController()

    ;(async () => {
      try {
        const [pubRes, preRes] = await Promise.all([
          publics.length > 0
            ? fetch('/api/stock-synthszr/batch-quotes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companies: publics }),
                signal: aborter.signal,
              }).then((r) => (r.ok ? r.json() : null))
              .catch(() => null)
            : Promise.resolve(null),
          premarkets.length > 0
            ? fetch('/api/premarket/batch-ratings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companies: premarkets }),
                signal: aborter.signal,
              }).then((r) => (r.ok ? r.json() : null))
              .catch(() => null)
            : Promise.resolve(null),
        ])

        const next = new Map<string, CompanyRating>()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const q of (pubRes?.quotes || []) as Array<any>) {
          const r: CompanyRating = {
            rating: q.rating ?? null,
            ticker: q.ticker ?? null,
            changePercent: typeof q.changePercent === 'number' ? q.changePercent : null,
            direction: q.direction ?? null,
          }
          next.set(String(q.company || '').toLowerCase(), r)
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const r of (preRes?.ratings || []) as Array<any>) {
          const item: CompanyRating = {
            rating: r.rating ?? null,
            ticker: null,
            changePercent: null,
            direction: null,
          }
          next.set(String(r.company || '').toLowerCase(), item)
        }
        // Persist + commit
        for (const [k, v] of next) ratingsCacheRef.current.set(k, v)
        setRatings((prev) => new Map([...prev, ...next]))
      } catch {
        // Aborted or network — silent fail, the dropdown still works
      }
    })()

    return () => aborter.abort()
  }, [results])

  const hasResults = results && (results.posts.length > 0 || results.companies.length > 0)
  const showEmpty = query.trim().length >= 2 && !loading && results && !hasResults

  return (
    <>
      <div className="mb-8">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={strings.placeholder}
            className="w-full rounded-full border border-border bg-background pl-11 pr-12 py-3 text-base focus:outline-none focus:ring-2 focus:ring-neon-cyan focus:border-neon-cyan transition-shadow"
            autoComplete="off"
            spellCheck={false}
          />
          {loading && (
            <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
          )}
        </div>

        {hasResults && (
          <div className="mt-3 rounded-lg border border-border bg-background shadow-sm overflow-hidden">
            {/* Synthszr-Analyse always on top — these are the unique
                value-add: AI investment ratings the user can't get
                from Google. Posts come below as supporting context. */}
            {results.companies.length > 0 && (
              <section>
                <header className="px-4 py-2 bg-muted/40 border-b border-border flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    {strings.companiesHeading(results.companies.length)}
                  </span>
                </header>
                <ul className="divide-y divide-border">
                  {results.companies.map((c) => {
                    const r = ratings.get(c.name.toLowerCase())
                    const pctText = typeof r?.changePercent === 'number'
                      ? `${r.changePercent >= 0 ? '+' : ''}${r.changePercent.toFixed(2)}%`
                      : null
                    const pctColor =
                      r?.direction === 'up' ? 'text-emerald-600 dark:text-emerald-400'
                        : r?.direction === 'down' ? 'text-red-600 dark:text-red-400'
                        : 'text-muted-foreground'
                    return (
                      <li key={`${c.type}:${c.slug}`}>
                        <button
                          type="button"
                          onClick={() => setOpenCompany(c)}
                          className="block w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="font-medium text-sm truncate">{c.name}</div>
                              {r?.ticker && (
                                <span className="text-[10px] font-mono uppercase text-muted-foreground/70 tracking-wider shrink-0">
                                  {r.ticker}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {pctText && (
                                <span className={`text-[11px] font-mono ${pctColor}`}>
                                  {pctText}
                                </span>
                              )}
                              {r?.rating && (
                                <span
                                  className={`text-[10px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${VOTE_COLOR[r.rating]}`}
                                >
                                  {r.rating}
                                </span>
                              )}
                              <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">
                                {c.type === 'public' ? 'Public' : 'Premarket'}
                              </span>
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            {results.posts.length > 0 && (
              <section>
                <header className="px-4 py-2 bg-muted/40 border-b border-t border-border flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    {strings.postsHeading(results.posts.length)}
                  </span>
                </header>
                <ul className="divide-y divide-border">
                  {results.posts.map((p) => {
                    // Pass the query through to the post page so the
                    // article body can highlight matches in place.
                    const base = locale === 'de' ? `/posts/${p.slug}` : `/${locale}/posts/${p.slug}`
                    const href = `${base}?q=${encodeURIComponent(query.trim())}`
                    const previewText = p.snippet || p.excerpt || ''
                    return (
                      <li key={p.id}>
                        <Link
                          href={href}
                          className="block px-4 py-3 hover:bg-muted/30 transition-colors"
                          onClick={() => setQuery('')}
                        >
                          <div className="font-medium text-sm leading-snug">
                            <HighlightedText text={p.title} query={query} />
                          </div>
                          {previewText && (
                            <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                              <HighlightedText text={previewText} query={query} />
                            </div>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
          </div>
        )}

        {showEmpty && (
          <div className="mt-3 rounded-lg border border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
            {strings.noResults(query.trim())}
          </div>
        )}
      </div>

      {openCompany && (
        <StockSynthszrLayer
          company={openCompany.name}
          onClose={() => setOpenCompany(null)}
        />
      )}
    </>
  )
}
