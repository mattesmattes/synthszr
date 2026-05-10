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

const DEBOUNCE_MS = 250

export function HomeSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [openCompany, setOpenCompany] = useState<CompanyHit | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null)
      setLoading(false)
      return
    }

    const handle = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        })
        if (res.ok) {
          const data = (await res.json()) as SearchResults
          setResults(data)
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
            placeholder="Suche im Blog Content oder nach Unternehmen…"
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
            {results.posts.length > 0 && (
              <section>
                <header className="px-4 py-2 bg-muted/40 border-b border-border flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    Blogposts ({results.posts.length})
                  </span>
                </header>
                <ul className="divide-y divide-border">
                  {results.posts.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/posts/${p.slug}`}
                        className="block px-4 py-3 hover:bg-muted/30 transition-colors"
                        onClick={() => setQuery('')}
                      >
                        <div className="font-medium text-sm leading-snug">{p.title}</div>
                        {(p.snippet || p.excerpt) && (
                          <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                            {p.snippet || p.excerpt}
                          </div>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {results.companies.length > 0 && (
              <section>
                <header className="px-4 py-2 bg-muted/40 border-b border-t border-border flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    Unternehmen ({results.companies.length}) — Synthszr-Analyse
                  </span>
                </header>
                <ul className="divide-y divide-border">
                  {results.companies.map((c) => (
                    <li key={`${c.type}:${c.slug}`}>
                      <button
                        type="button"
                        onClick={() => setOpenCompany(c)}
                        className="block w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-sm">{c.name}</div>
                          <div className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">
                            {c.type === 'public' ? 'Public' : 'Premarket'}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {showEmpty && (
          <div className="mt-3 rounded-lg border border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
            Keine Treffer für „{query.trim()}".
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
