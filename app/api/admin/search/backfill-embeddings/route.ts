import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { embedPostContent } from '@/lib/search/embeddings'

// Manual backfill of generated_posts.content_embedding for the
// home-page search. Idempotent — only processes rows where
// content_embedding IS NULL. Pages 20 at a time, runs to completion
// or up to ~10 minutes (whichever comes first).
//
// Triggered manually after applying the
// 20260510_search_embeddings.sql migration.

export const runtime = 'nodejs'
export const maxDuration = 600 // 10 minutes

const BATCH_SIZE = 20
const BETWEEN_CALLS_MS = 150
const SOFT_DEADLINE_MS = 8 * 60 * 1000 // stop ingesting new batches after 8 min

export async function POST() {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const startedAt = Date.now()

  let processed = 0
  let skipped = 0
  let failed = 0
  const failures: Array<{ id: string; reason: string }> = []

  while (true) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      console.log('[search-backfill] Soft deadline hit, stopping.')
      break
    }

    const { data: posts, error } = await supabase
      .from('generated_posts')
      .select('id, title, excerpt, content')
      .is('content_embedding', null)
      .eq('status', 'published')
      .limit(BATCH_SIZE)

    if (error) {
      return NextResponse.json(
        { error: `Fetch failed: ${error.message}`, processed, skipped, failed },
        { status: 500 }
      )
    }
    if (!posts || posts.length === 0) {
      console.log('[search-backfill] No more posts without embeddings.')
      break
    }

    for (const p of posts) {
      try {
        const vec = await embedPostContent(p)
        if (vec.length === 0) {
          skipped++
          continue
        }
        const { error: upErr } = await supabase
          .from('generated_posts')
          .update({ content_embedding: vec as unknown as string })
          .eq('id', p.id)
        if (upErr) {
          failed++
          failures.push({ id: p.id, reason: upErr.message })
          console.error(`[search-backfill] Update failed for ${p.id}:`, upErr.message)
        } else {
          processed++
        }
      } catch (err) {
        failed++
        const reason = err instanceof Error ? err.message : String(err)
        failures.push({ id: p.id, reason })
        console.error(`[search-backfill] Embed failed for ${p.id}:`, reason)
      }
      await new Promise((r) => setTimeout(r, BETWEEN_CALLS_MS))
    }

    console.log(`[search-backfill] Batch done. processed=${processed} skipped=${skipped} failed=${failed}`)
  }

  const elapsedMs = Date.now() - startedAt
  return NextResponse.json({
    ok: true,
    processed,
    skipped,
    failed,
    failures: failures.slice(0, 20),
    elapsedMs,
    deadlineHit: elapsedMs > SOFT_DEADLINE_MS,
  })
}

/**
 * GET — quick status: how many published posts still lack an embedding?
 */
export async function GET() {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { count: missing, error: missingErr } = await supabase
    .from('generated_posts')
    .select('id', { count: 'exact', head: true })
    .is('content_embedding', null)
    .eq('status', 'published')

  const { count: total, error: totalErr } = await supabase
    .from('generated_posts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')

  if (missingErr || totalErr) {
    return NextResponse.json(
      { error: missingErr?.message || totalErr?.message || 'unknown' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    publishedPosts: total ?? 0,
    missingEmbeddings: missing ?? 0,
    coveragePct: total ? Math.round(((total - (missing ?? 0)) / total) * 100) : 0,
  })
}
