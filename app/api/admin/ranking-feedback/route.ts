// app/api/admin/ranking-feedback/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/session'
import { recordFeedback } from '@/lib/news-queue/suggestions'
import { selectItemsForArticle } from '@/lib/news-queue/service'
import type { UserAction } from '@/lib/news-queue/ranking-types'

const VALID: UserAction[] = ['accepted', 'rejected', 'added', 'reordered']

export async function POST(req: NextRequest) {
  const authError = await requireAdmin(req)
  if (authError) return authError
  try {
    const { runId, queueItemId, action, finalRank } = await req.json()
    if (!runId || !queueItemId || !VALID.includes(action)) {
      return NextResponse.json({ ok: false, error: 'invalid payload' }, { status: 400 })
    }
    await recordFeedback(runId, queueItemId, action as UserAction, finalRank ?? null)

    // "Behalten" / manually added → put the item into the selected queue so the
    // Ghostwriter has its basis. (selectItemsForArticle only flips pending→selected.)
    if (action === 'accepted' || action === 'added') {
      await selectItemsForArticle([queueItemId])
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[API/ranking-feedback] failed:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
