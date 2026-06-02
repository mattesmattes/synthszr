// app/api/admin/ranking/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateRankingSuggestions } from '@/lib/news-queue/ranking-service'

export const maxDuration = 120

// POST: generate a fresh ranking run.
export async function POST(req: NextRequest) {
  const authError = await requireAdmin(req)
  if (authError) return authError
  try {
    const body = await req.json().catch(() => ({}))
    const stage1 = body.stage1 === 'all' ? 'all' : body.stage1 === 'rrf' ? 'rrf' : undefined
    const result = await generateRankingSuggestions(stage1)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[API/ranking] POST failed:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

// GET: latest run + its suggestions joined with item titles.
export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req)
  if (authError) return authError
  const supabase = createAdminClient()
  const { data: run } = await supabase
    .from('ranking_runs')
    .select('id, created_at, stage1_method')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!run) return NextResponse.json({ runId: null, suggestions: [] })

  const { data: sugg } = await supabase
    .from('ranking_suggestions')
    .select('queue_item_id, suggested_rank, llm_reason, confidence, user_action, news_queue(title, source_display_name)')
    .eq('run_id', run.id)
    .order('suggested_rank', { ascending: true })

  const suggestions = (sugg || []).map((s) => {
    const nq = s.news_queue as unknown as { title: string; source_display_name: string | null } | null
    return {
      queueItemId: s.queue_item_id,
      rank: s.suggested_rank,
      reason: s.llm_reason,
      confidence: s.confidence,
      userAction: s.user_action,
      title: nq?.title ?? '',
      source: nq?.source_display_name ?? null,
    }
  })

  return NextResponse.json({ runId: run.id, stage1Method: run.stage1_method, suggestions })
}
