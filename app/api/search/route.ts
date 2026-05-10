import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'

// Keyword-driven search across post titles, excerpts, and content,
// plus a dictionary match against the known-company list. This is the
// first step toward an embedding-backed semantic search; for now,
// PostgreSQL ILIKE is fast enough for the corpus size.

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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const rawQuery = (searchParams.get('q') || '').trim()

  if (rawQuery.length < 2) {
    return NextResponse.json({ posts: [], companies: [] })
  }

  // Sanitize for use in ILIKE patterns (escape % and _, then wrap)
  const escaped = rawQuery.replace(/[\\%_]/g, (m) => `\\${m}`)
  const pattern = `%${escaped}%`

  const supabase = await createClient()

  // 1. Manual posts — published only, search title + excerpt + content::text
  const manualPostsPromise = supabase
    .from('posts')
    .select('id, title, slug, excerpt, content, created_at')
    .eq('published', true)
    .or(`title.ilike.${pattern},excerpt.ilike.${pattern}`)
    .order('created_at', { ascending: false })
    .limit(MAX_POSTS)

  // 2. AI-generated posts — same approach, on generated_posts table
  const aiPostsPromise = supabase
    .from('generated_posts')
    .select('id, title, slug, excerpt, content, created_at')
    .eq('published', true)
    .or(`title.ilike.${pattern},excerpt.ilike.${pattern}`)
    .order('created_at', { ascending: false })
    .limit(MAX_POSTS)

  const [{ data: manualPosts }, { data: aiPosts }] = await Promise.all([
    manualPostsPromise,
    aiPostsPromise,
  ])

  const posts: PostHit[] = []

  function buildSnippet(content: unknown, query: string): string | null {
    // Content is TipTap JSON; flatten to plain text and find a window
    // around the first match.
    let plain = ''
    try {
      const json = typeof content === 'string' ? JSON.parse(content) : content
      const collect = (node: unknown): void => {
        if (!node || typeof node !== 'object') return
        const n = node as Record<string, unknown>
        if (typeof n.text === 'string') plain += n.text + ' '
        if (Array.isArray(n.content)) n.content.forEach(collect)
      }
      collect(json)
    } catch {
      plain = typeof content === 'string' ? content : ''
    }

    const idx = plain.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return null
    const start = Math.max(0, idx - 60)
    const end = Math.min(plain.length, idx + query.length + 80)
    return (start > 0 ? '… ' : '') + plain.slice(start, end).trim() + (end < plain.length ? ' …' : '')
  }

  for (const p of manualPosts || []) {
    posts.push({
      id: p.id,
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt ?? null,
      snippet: buildSnippet(p.content, rawQuery),
      type: 'manual',
      created_at: p.created_at,
    })
  }
  for (const p of aiPosts || []) {
    posts.push({
      id: p.id,
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt ?? null,
      snippet: buildSnippet(p.content, rawQuery),
      type: 'ai',
      created_at: p.created_at,
    })
  }

  // De-dupe by slug (manual takes precedence) and sort by recency
  const seenSlugs = new Set<string>()
  const dedupedPosts = posts
    .filter((p) => {
      if (seenSlugs.has(p.slug)) return false
      seenSlugs.add(p.slug)
      return true
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, MAX_POSTS)

  // 3. Company dictionary match — case-insensitive substring
  const lowerQuery = rawQuery.toLowerCase()
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
