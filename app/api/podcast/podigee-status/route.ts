import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

/**
 * GET /api/podcast/podigee-status?postId=X
 *
 * Reads the Podigee publication state straight from post_podcasts —
 * persisted by /api/podcast/publish-podigee on success. Earlier
 * implementations queried the Podigee API directly and tried to
 * fuzzy-match episodes by date/title; that fights production
 * (Podigee API returned 404) and false-negatives common cases.
 *
 * Source of truth: post_podcasts.podigee_episode_url
 */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const postId = searchParams.get('postId')
  if (!postId) {
    return NextResponse.json({ error: 'postId erforderlich' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Pick the most recent publication for this post across locales.
  // Multiple post_podcasts rows can exist (one per locale); whichever
  // one was published last is what the admin saw on the audio page.
  const { data, error } = await supabase
    .from('post_podcasts')
    .select('podigee_episode_id, podigee_episode_url, podigee_published_at')
    .eq('post_id', postId)
    .not('podigee_episode_url', 'is', null)
    .order('podigee_published_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[Podigee Status] DB error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data || !data.podigee_episode_url) {
    return NextResponse.json({ published: false })
  }

  return NextResponse.json({
    published: true,
    episodeId: data.podigee_episode_id,
    episodeUrl: data.podigee_episode_url,
    publishedAt: data.podigee_published_at,
  })
}
