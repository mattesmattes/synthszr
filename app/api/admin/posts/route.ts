/**
 * GET /api/admin/posts
 * List posts for admin selection (e.g., podcast generation)
 *
 * Query params:
 * - limit: number (default: 20)
 * - published: boolean (default: true)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const publishedOnly = searchParams.get('published') !== 'false'

    const supabase = await createClient()

    // Fetch from generated_posts (AI-generated posts)
    let query = supabase
      .from('generated_posts')
      .select('id, title, slug, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (publishedOnly) {
      query = query.eq('status', 'published')
    }

    const { data: posts, error } = await query

    if (error) {
      console.error('[Admin Posts] Query error:', error)
      return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 })
    }

    return NextResponse.json({
      posts: posts || [],
      count: posts?.length || 0,
    })
  } catch (error) {
    console.error('[Admin Posts] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
