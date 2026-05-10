import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import { embedQuery } from '@/lib/search/embeddings'
import { rerankPostHits } from '@/lib/search/rerank'

// Search pipeline:
//   1. Embedding similarity over generated_posts (semantic recall)
//   2. Substring match over title / excerpt / plain content of every
//      post type (exact-keyword recall — catches recent posts that
//      don't yet have an embedding, plus literal terms like product
//      names that embeddings sometimes lose)
//   3. Merge + de-dupe by slug (manual posts win)
//   4. LLM re-rank top-N via Claude Haiku for "really relevant first"
//   5. Return top MAX_POSTS, plus separate company dictionary hits

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
// How many recent posts to scan in Node for substring recall. 500
// covers years of daily newsletters; raise if/when needed.
const FETCH_LIMIT = 500
// How many semantic neighbors the embedding RPC returns before merge.
const EMBEDDING_TOP_K = 30
// Minimum cosine similarity to keep an embedding hit.
const EMBEDDING_THRESHOLD = 0.35

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
  const admin = createAdminClient() // for the vector RPC (server-side only)

  // Fire all three lookups in parallel:
  //   - manual posts (substring recall)
  //   - AI posts (substring recall)
  //   - AI posts via embedding similarity (semantic recall)
  const embeddingPromise = (async () => {
    try {
      const queryVec = await embedQuery(rawQuery)
      if (queryVec.length === 0) return []
      const { data, error } = await admin.rpc('match_generated_posts', {
        query_embedding: queryVec as unknown as string,
        match_threshold: EMBEDDING_THRESHOLD,
        match_count: EMBEDDING_TOP_K,
      })
      if (error) {
        console.warn('[Search] match_generated_posts RPC failed:', error.message)
        return []
      }
      return (data as Array<{
        id: string; title: string; slug: string
        excerpt: string | null; content: unknown
        created_at: string; similarity: number
      }>) || []
    } catch (err) {
      console.warn('[Search] embedding lookup failed:', err)
      return []
    }
  })()

  const [manualResult, aiResult, embeddingHits] = await Promise.all([
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
    embeddingPromise,
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

  // Add semantic-recall hits from the embedding RPC. These may overlap
  // with substring hits — the slug-dedupe below handles that. For
  // non-overlapping hits, build a snippet from the first ~140 chars of
  // the content as the keyword likely doesn't appear literally.
  for (const p of embeddingHits) {
    const fallbackPlain = tiptapToPlain(p.content)
    hits.push({
      id: p.id,
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt ?? null,
      snippet: fallbackPlain.slice(0, 200).trim() + (fallbackPlain.length > 200 ? ' …' : ''),
      type: 'ai',
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

  // LLM re-rank for semantic relevance, then trim to MAX_POSTS
  const reranked = await rerankPostHits(rawQuery, dedupedPosts)
  const finalPosts = reranked.slice(0, MAX_POSTS)

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

  return NextResponse.json({ posts: finalPosts, companies })
}
