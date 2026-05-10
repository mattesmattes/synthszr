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
// Skip LLM re-rank below these thresholds — short queries and small
// candidate sets don't benefit much, and the round-trip dominates the
// total response time.
const RERANK_MIN_QUERY_LEN = 5
const RERANK_MIN_CANDIDATES = 4

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
  const locale = (searchParams.get('locale') || 'de').trim().toLowerCase()
  const isDefaultLocale = locale === 'de'

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

  // For substring recall we only need title + excerpt. Skipping the
  // jsonb content column shrinks payload by ~10× and lets PostgREST
  // cache the metadata page. Embedding hits already come back from
  // the RPC with full content, so content snippets still work for the
  // semantic-only matches.
  const aiCorpusPromise = isDefaultLocale
    ? supabase
        .from('generated_posts')
        .select('id, title, slug, excerpt, created_at')
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(FETCH_LIMIT)
    : supabase
        .from('content_translations')
        .select('generated_post_id, title, slug, excerpt, generated_posts!inner(id, status, created_at)')
        .eq('language_code', locale)
        .eq('translation_status', 'completed')
        .eq('generated_posts.status', 'published')
        .not('generated_post_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(FETCH_LIMIT)

  const [manualResult, aiResult, embeddingHits] = await Promise.all([
    isDefaultLocale
      ? supabase
          .from('posts')
          .select('id, title, slug, excerpt, created_at')
          .eq('published', true)
          .order('created_at', { ascending: false })
          .limit(FETCH_LIMIT)
      : Promise.resolve({ data: [] as never[] }),
    aiCorpusPromise,
    embeddingPromise,
  ])

  // Normalize translation rows to the same shape as generated_posts.
  // No content field — substring search runs on title + excerpt only;
  // semantic recall covers the body via the embedding RPC.
  type NormalizedPost = {
    id: string
    title: string
    slug: string
    excerpt: string | null
    created_at: string
    type: 'manual' | 'ai'
  }

  const aiNormalized: NormalizedPost[] = []
  if (isDefaultLocale) {
    for (const p of (aiResult.data || []) as Array<NormalizedPost>) {
      aiNormalized.push({ ...p, type: 'ai' })
    }
  } else {
    type TranslationJoin = {
      generated_post_id: string
      title: string | null
      slug: string | null
      excerpt: string | null
      generated_posts: { id: string; status: string; created_at: string } | { id: string; status: string; created_at: string }[] | null
    }
    for (const t of (aiResult.data || []) as unknown as TranslationJoin[]) {
      if (!t.generated_post_id || !t.title || !t.slug || !t.generated_posts) continue
      // Supabase returns nested foreign-key joins as either an object
      // or a single-element array depending on relationship cardinality.
      const parent = Array.isArray(t.generated_posts) ? t.generated_posts[0] : t.generated_posts
      if (!parent) continue
      aiNormalized.push({
        id: t.generated_post_id,
        title: t.title,
        slug: t.slug,
        excerpt: t.excerpt ?? null,
        created_at: parent.created_at,
        type: 'ai',
      })
    }
  }

  const allPosts: NormalizedPost[] = [
    ...((manualResult.data || []) as Array<NormalizedPost>).map((p) => ({ ...p, type: 'manual' as const })),
    ...aiNormalized,
  ]

  // Substring filter: hit if query appears in title or excerpt.
  // The full body is no longer fetched here for speed — the embedding
  // RPC catches body matches semantically (and usually ranks them
  // higher than literal substrings anyway).
  const hits: PostHit[] = []
  for (const p of allPosts) {
    const title = (p.title || '').toLowerCase()
    const excerpt = (p.excerpt || '').toLowerCase()
    const inTitle = title.includes(lowerQuery)
    const inExcerpt = excerpt.includes(lowerQuery)

    if (!inTitle && !inExcerpt) continue

    const snippet: string | null = inExcerpt
      ? buildSnippet(p.excerpt || '', rawQuery)
      : null

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
  // with substring hits — the slug-dedupe below handles that.
  // For non-default locales, look up the translated title/slug/excerpt
  // so the dropdown stays in the user's language. Embedding lookup
  // itself runs on the German source content, which is fine because
  // gemini-embedding-001 is multilingual — semantic similarity holds
  // across language pairs.
  let translationMap: Map<string, {
    title: string | null; slug: string | null; excerpt: string | null; content: unknown
  }> | null = null
  if (!isDefaultLocale && embeddingHits.length > 0) {
    const ids = embeddingHits.map((h) => h.id)
    const { data: translations } = await supabase
      .from('content_translations')
      .select('generated_post_id, title, slug, excerpt, content')
      .in('generated_post_id', ids)
      .eq('language_code', locale)
      .eq('translation_status', 'completed')
    translationMap = new Map(
      (translations || []).map((t) => [t.generated_post_id, t])
    )
  }

  for (const p of embeddingHits) {
    let title = p.title
    let slug = p.slug
    let excerpt = p.excerpt ?? null
    let content = p.content
    if (translationMap) {
      const t = translationMap.get(p.id)
      if (!t || !t.slug || !t.title) {
        // No translation yet — drop the hit rather than show DE in a
        // non-DE locale dropdown.
        continue
      }
      title = t.title
      slug = t.slug
      excerpt = t.excerpt ?? null
      content = t.content
    }
    const fallbackPlain = tiptapToPlain(content)
    hits.push({
      id: p.id,
      title,
      slug,
      excerpt,
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

  // LLM re-rank only when it's likely to add value: enough candidates
  // and a query long enough to disambiguate. Short queries / small
  // result sets don't benefit and the round-trip dominates latency.
  const shouldRerank =
    rawQuery.length >= RERANK_MIN_QUERY_LEN &&
    dedupedPosts.length >= RERANK_MIN_CANDIDATES
  const reranked = shouldRerank
    ? await rerankPostHits(rawQuery, dedupedPosts)
    : dedupedPosts
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
