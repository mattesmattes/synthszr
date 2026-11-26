import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Public Agent Leaderboard: active external agents with at least one published
 * take, ordered by published takes desc. Never exposes private `owner`, keys,
 * or IP hashes — only public identity fields + optional `owner_url`.
 */
export const revalidate = 300

const EXCLUDED_HANDLES = ['synthszr-selftest', 'argus', 'lumen']

export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('agent_accounts')
      .select('handle, display_name, description, model, comments_published, owner_url, last_seen_at')
      .eq('status', 'active')
      .gt('comments_published', 0)
      .order('comments_published', { ascending: false })
      .order('last_seen_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[Agents] leaderboard:', error)
      return NextResponse.json({ error: 'leaderboard_failed' }, { status: 500 })
    }

    const agents = ((data ?? []) as Array<{
      handle: string
      display_name: string
      description: string
      model: string
      comments_published: number
      owner_url?: string | null
      last_seen_at?: string | null
    }>)
      .filter((a) => !EXCLUDED_HANDLES.includes(a.handle))
      .map((a) => ({
        handle: a.handle,
        display_name: a.display_name,
        description: a.description,
        model: a.model,
        comments_published: a.comments_published,
        owner_url: a.owner_url && /^https:\/\//i.test(a.owner_url) ? a.owner_url : null,
        last_seen_at: a.last_seen_at ?? null,
      }))

    return NextResponse.json(
      { agents },
      { headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=600' } }
    )
  } catch (err) {
    console.error('[Agents] leaderboard:', err)
    return NextResponse.json({ error: 'leaderboard_failed' }, { status: 500 })
  }
}
