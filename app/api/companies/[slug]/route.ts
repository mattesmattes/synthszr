import { NextRequest, NextResponse } from 'next/server'
import { createAnonClient } from '@/lib/supabase/admin'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

// Relaxed rate limiter: 100 requests per minute per IP (public read endpoint)
const relaxedLimiter = rateLimiters.relaxed()

interface PostInfo {
  id: string
  title: string
  slug: string
  excerpt: string | null
  created_at: string
}

/**
 * GET /api/companies/[slug]
 *
 * Returns company details and all posts that mention this company.
 * Only includes published posts.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  // Rate limit check - 100 requests per minute per IP
  const clientIP = getClientIP(request)
  const rateLimitResult = await checkRateLimit(`company-detail:${clientIP}`, relaxedLimiter ?? undefined)

  if (!rateLimitResult.success) {
    return rateLimitResponse(rateLimitResult)
  }

  try {
    const { slug } = await params
    const supabase = createAnonClient()

    // Fetch company info and related posts
    const { data: mentions, error } = await supabase
      .from('post_company_mentions')
      .select(`
        company_name,
        company_slug,
        company_type,
        post:generated_posts!inner(
          id,
          title,
          slug,
          excerpt,
          created_at,
          status
        )
      `)
      .eq('company_slug', slug)
      .eq('post.status', 'published')
      .order('created_at', { ascending: false })

    if (error) {
      console.error(`[api/companies/${slug}] Query error:`, error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!mentions || mentions.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Unternehmen nicht gefunden' },
        { status: 404 }
      )
    }

    // Extract company info from first mention
    const firstMention = mentions[0]
    const company = {
      name: firstMention.company_name,
      slug: firstMention.company_slug,
      type: firstMention.company_type,
    }

    // Extract unique posts (in case of duplicates)
    const postMap = new Map<string, PostInfo>()
    for (const mention of mentions) {
      const post = mention.post as unknown as PostInfo & { status: string }
      if (!postMap.has(post.id)) {
        postMap.set(post.id, {
          id: post.id,
          title: post.title,
          slug: post.slug || post.id,
          excerpt: post.excerpt,
          created_at: post.created_at,
        })
      }
    }

    // Sort posts by date (newest first)
    const posts = Array.from(postMap.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json({
      ok: true,
      company,
      posts,
      total: posts.length,
    })
  } catch (error) {
    console.error('[api/companies/[slug]] Failed:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
