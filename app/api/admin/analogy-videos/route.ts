import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const postId = searchParams.get('postId')
  const videoType = searchParams.get('videoType')
  const limit = parseInt(searchParams.get('limit') || '50')

  const supabase = createAdminClient()

  let query = supabase
    .from('analogy_videos')
    .select(`
      *,
      generated_posts!inner(title, slug)
    `)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) {
    query = query.eq('status', status)
  }
  if (postId) {
    query = query.eq('post_id', postId)
  }
  if (videoType) {
    query = query.eq('video_type', videoType)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data || [])
}
