import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'

// Search across post titles, excerpts, and full body content, plus a
// dictionary match against the known-company list.
//
// We do the filtering in Node rather than via PostgREST .ilike on the
// jsonb content column: TipTap content is stored as jsonb and ILIKE
// against jsonb requires explicit ::text casting, which Supabase's
// REST client doesn't expose cleanly. Fetching the recent corpus
// (capped at FETCH_LIMIT) and filtering in memory is fast for the
// current size and gives us precise snippet extraction in one pass.

interface PostHit {
  id: string
  title: string
  slug: string
  excerpt: string | null
  snippet: string | null
  type: 'manual' | 'ai'
  created_at: string
}

interface CompanyHit {
  name: string
  slug: string
  type: 'public' | 'premarket'
}

const MAX_POSTS = 8
const MAX_COMPANIES = 6
// How many recent posts to scan in Node. 500 covers years of daily
// newsletters; raise if/when we need to.
const FETCH_LIMIT = 500

function tiptapToPlain(content: unknown): string {
  if (!content) return ''
  if (typeof content === 'string') {
    // Already plain text or stringified JSON
    try {
      return tiptapToPlain(JSON.parse(content))
    } catch {
      return content
    }
  }
  let plain = ''
  const collect = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as Record<string, unknown>
    if (typeof n.text === 'string') plain += n.text + ' '
    if (Array.isArray(n.content)) n.content.forEach(collect)
  }
  collect(content)
  return plain
}

function buildSnippet(plain: string, query: string): string | null {
  const idx = plain.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return null
  const start = Math.max(0, idx - 60)
  const end = Math.min(plain.length, idx + query.length + 80)
  return (start > 0 ? '… ' : '') + plain.slice(start, end).trim() + (end < plain.length ? ' …' : '')
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const rawQuery = (searchParams.get('q') || '').trim()

  if (rawQuery.length < 2) {
    return NextResponse.json({ posts: [], companies: [] })
  }

  const lowerQuery = rawQuery.toLowerCase()

  const supabase = await createClient()

  // Fetch a generous slice of recent published posts; filter in Node.
  const [manualResult, aiResult] = await Promise.all([
    supabase
      .from('posts')
      .select('id, title, slug, excerpt, content, created_at')
      .eq('published', true)
      .order('created_at', { ascending: false })
      .limit(FETCH_LIMIT),
    supabase
      .from('generated_posts')
      .select('id, title, slug, excerpt, content, created_at')
      .eq('published', true)
      .order('created_at', { ascending: false })
      .limit(FETCH_LIMIT),
  ])

  const allPosts: Array<{
    id: string
    title: string
    slug: string
    excerpt: string | null
    content: unknown
    created_at: string
    type: 'manual' | 'ai'
  }> = [
    ...(manualResult.data || []).map((p) => ({ ...p, type: 'manual' as const })),
    ...(aiResult.data || []).map((p) => ({ ...p, type: 'ai' as const })),
  ]

  // Filter: hit if query appears in title, excerpt, OR plain-text content.
  // Snippet preference: content snippet > excerpt-as-snippet > null.
  const hits: PostHit[] = []
  for (const p of allPosts) {
    const title = (p.title || '').toLowerCase()
    const excerpt = (p.excerpt || '').toLowerCase()
    const inTitle = title.includes(lowerQuery)
    const inExcerpt = excerpt.includes(lowerQuery)

    let plain = ''
    let inContent = false
    if (!inTitle && !inExcerpt) {
      plain = tiptapToPlain(p.content)
      inContent = plain.toLowerCase().includes(lowerQuery)
    }

    if (!inTitle && !inExcerpt && !inContent) continue

    // Build a snippet from whichever field actually matched
    let snippet: string | null = null
    if (inContent) {
      snippet = buildSnippet(plain, rawQuery)
    } else if (inExcerpt) {
      snippet = buildSnippet(p.excerpt || '', rawQuery)
    }

    hits.push({
      id: p.id,
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt ?? null,
      snippet,
      type: p.type,
      created_at: p.created_at,
    })
  }

  // De-dupe by slug, prefer manual, then by recency
  const seenSlugs = new Set<string>()
  const dedupedPosts = hits
    .sort((a, b) => {
      // manual first when slugs collide, else recency
      if (a.slug === b.slug) return a.type === 'manual' ? -1 : 1
      return b.created_at.localeCompare(a.created_at)
    })
    .filter((p) => {
      if (seenSlugs.has(p.slug)) return false
      seenSlugs.add(p.slug)
      return true
    })
    .slice(0, MAX_POSTS)

  // 3. Company dictionary match — case-insensitive substring
  const companies: CompanyHit[] = []

  for (const [name, slug] of Object.entries(KNOWN_COMPANIES)) {
    if (companies.length >= MAX_COMPANIES) break
    if (name.toLowerCase().includes(lowerQuery)) {
      companies.push({ name, slug, type: 'public' })
    }
  }
  for (const [name, slug] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
    if (companies.length >= MAX_COMPANIES) break
    if (name.toLowerCase().includes(lowerQuery)) {
      companies.push({ name, slug, type: 'premarket' })
    }
  }

  // Prefer exact-prefix matches first
  companies.sort((a, b) => {
    const aPrefix = a.name.toLowerCase().startsWith(lowerQuery) ? 0 : 1
    const bPrefix = b.name.toLowerCase().startsWith(lowerQuery) ? 0 : 1
    if (aPrefix !== bPrefix) return aPrefix - bPrefix
    return a.name.localeCompare(b.name)
  })

  return NextResponse.json({ posts: dedupedPosts, companies })
}
