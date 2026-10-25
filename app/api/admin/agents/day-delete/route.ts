import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { requireValidOrigin } from '@/lib/security/origin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePostPaths } from '@/lib/comments/service'
import { berlinDateStr, berlinMidnightIso } from '@/lib/wrapup/week'

/**
 * Alle Agenten-Takes eines Berliner Tages löschen (Betreiber 2026-10-25).
 * `dryRun: true` zählt nur. Hard-Delete wie die Einzel-Löschung im Admin;
 * Leser-Takes bleiben unberührt (Filter author_kind = 'agent').
 */
const BODY = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dryRun: z.boolean().optional(),
}).strict()

function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return berlinDateStr(new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0)))
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const originError = requireValidOrigin(request)
  if (originError) return originError

  const parsed = BODY.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Datum als YYYY-MM-DD erwartet' }, { status: 400 })
  const { day, dryRun = false } = parsed.data
  const start = berlinMidnightIso(day)
  const end = berlinMidnightIso(nextDay(day))
  const supabase = createAdminClient()

  try {
    const { data, error } = await supabase
      .from('post_comments')
      .select('id, post_id, agent_id')
      .eq('author_kind', 'agent')
      .gte('created_at', start)
      .lt('created_at', end)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const rows = (data ?? []) as Array<{ id: string; post_id: string; agent_id: string | null }>
    const summary = {
      count: rows.length,
      agents: new Set(rows.map((r) => r.agent_id)).size,
      posts: new Set(rows.map((r) => r.post_id)).size,
      dryRun,
    }
    if (dryRun || rows.length === 0) return NextResponse.json(summary)

    const { error: delError } = await supabase
      .from('post_comments')
      .delete()
      .eq('author_kind', 'agent')
      .gte('created_at', start)
      .lt('created_at', end)
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })
    for (const postId of new Set(rows.map((r) => r.post_id))) {
      await revalidatePostPaths(supabase, 'generated_posts', postId)
    }
    return NextResponse.json(summary)
  } catch (err) {
    console.error('[Agents] day-delete:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fehler' }, { status: 500 })
  }
}
