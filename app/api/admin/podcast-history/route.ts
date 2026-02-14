import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')
  const search = searchParams.get('search')

  const supabase = createAdminClient()

  // Fetch completed podcasts — one row per post (deduplicate by picking 'de' locale)
  let query = supabase
    .from('post_podcasts')
    .select('id, post_id, locale, audio_url, duration_seconds, script_content, created_at')
    .eq('status', 'completed')
    .eq('locale', 'de')
    .not('audio_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (dateFrom) {
    query = query.gte('created_at', `${dateFrom}T00:00:00`)
  }
  if (dateTo) {
    query = query.lte('created_at', `${dateTo}T23:59:59`)
  }
  if (search?.trim()) {
    query = query.ilike('script_content', `%${search.trim()}%`)
  }

  const { data: rows, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ episodes: [] })
  }

  // Fetch post titles
  const postIds = [...new Set(rows.map(r => r.post_id))]
  const { data: posts } = await supabase
    .from('generated_posts')
    .select('id, title, slug')
    .in('id', postIds)

  const postMap = new Map<string, { title: string; slug: string }>()
  for (const p of posts ?? []) {
    postMap.set(p.id, { title: p.title, slug: p.slug })
  }

  const episodes = rows.map(r => ({
    id: r.id,
    title: postMap.get(r.post_id)?.title ?? null,
    script: r.script_content,
    audio_url: r.audio_url,
    locale: r.locale,
    duration_seconds: r.duration_seconds,
    created_at: r.created_at,
    post_id: r.post_id,
    slug: postMap.get(r.post_id)?.slug ?? null,
  }))

  return NextResponse.json({ episodes })
}
