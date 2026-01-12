import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/admin/translations
 * Returns translation statistics and queue items
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'all'
    const language = searchParams.get('language')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    const supabase = await createClient()

    // Get queue statistics
    const { data: allQueueItems } = await supabase
      .from('translation_queue')
      .select('status, target_language')

    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      byLanguage: {} as Record<string, { pending: number; completed: number; failed: number }>,
    }

    allQueueItems?.forEach(item => {
      const s = item.status as keyof typeof stats
      if (s in stats && typeof stats[s] === 'number') {
        (stats[s] as number)++
      }

      // By language stats
      if (!stats.byLanguage[item.target_language]) {
        stats.byLanguage[item.target_language] = { pending: 0, completed: 0, failed: 0 }
      }
      if (item.status === 'pending' || item.status === 'processing') {
        stats.byLanguage[item.target_language].pending++
      } else if (item.status === 'completed') {
        stats.byLanguage[item.target_language].completed++
      } else if (item.status === 'failed') {
        stats.byLanguage[item.target_language].failed++
      }
    })

    // Get queue items with filters
    let query = supabase
      .from('translation_queue')
      .select('*')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status !== 'all') {
      query = query.eq('status', status)
    }

    if (language) {
      query = query.eq('target_language', language)
    }

    const { data: queueItems, error: queueError } = await query

    if (queueError) {
      console.error('[Translations] Queue fetch error:', queueError)
    }

    // Enrich queue items with content titles
    const enrichedItems = await Promise.all(
      (queueItems || []).map(async (item) => {
        if (item.content_type === 'generated_post' && item.content_id) {
          const { data: post } = await supabase
            .from('generated_posts')
            .select('id, title, slug')
            .eq('id', item.content_id)
            .single()
          return { ...item, generated_posts: post }
        } else if (item.content_type === 'static_page' && item.content_id) {
          const { data: page } = await supabase
            .from('static_pages')
            .select('id, title, slug')
            .eq('id', item.content_id)
            .single()
          return { ...item, static_pages: page }
        }
        return item
      })
    )

    // Get completed translations count
    const { count: translationsCount } = await supabase
      .from('content_translations')
      .select('*', { count: 'exact', head: true })
      .eq('translation_status', 'completed')

    // Get manually edited count
    const { count: manualCount } = await supabase
      .from('content_translations')
      .select('*', { count: 'exact', head: true })
      .eq('is_manually_edited', true)

    return NextResponse.json({
      stats,
      queueItems: enrichedItems,
      translationsCount: translationsCount || 0,
      manuallyEditedCount: manualCount || 0,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/translations
 * Actions on translations (retry, cancel, etc.)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, queue_item_id, translation_id } = body

    const supabase = await createClient()

    if (action === 'retry' && queue_item_id) {
      // Reset failed or cancelled item to pending
      const { error } = await supabase
        .from('translation_queue')
        .update({
          status: 'pending',
          attempts: 0,
          last_error: null,
          started_at: null,
          completed_at: null,
        })
        .eq('id', queue_item_id)
        .in('status', ['failed', 'cancelled'])

      if (error) {
        return NextResponse.json({ error: 'Failed to retry item' }, { status: 500 })
      }

      return NextResponse.json({ message: 'Item queued for retry' })
    }

    if (action === 'cancel' && queue_item_id) {
      const { error } = await supabase
        .from('translation_queue')
        .update({ status: 'cancelled' })
        .eq('id', queue_item_id)
        .in('status', ['pending', 'processing'])

      if (error) {
        return NextResponse.json({ error: 'Failed to cancel item' }, { status: 500 })
      }

      return NextResponse.json({ message: 'Item cancelled' })
    }

    if (action === 'process') {
      // Trigger queue processing
      const res = await fetch(new URL('/api/admin/translations/process-queue', request.url).toString(), {
        method: 'POST',
      })
      const data = await res.json()
      return NextResponse.json(data)
    }

    if (action === 'retry-all-failed') {
      // Reset all failed items to pending
      const { data, error } = await supabase
        .from('translation_queue')
        .update({
          status: 'pending',
          attempts: 0,
          last_error: null,
          started_at: null,
          completed_at: null,
        })
        .eq('status', 'failed')
        .select('id')

      if (error) {
        return NextResponse.json({ error: 'Failed to retry items' }, { status: 500 })
      }

      return NextResponse.json({ message: `${data?.length || 0} items queued for retry`, count: data?.length || 0 })
    }

    if (action === 'toggle_manual' && translation_id) {
      // Toggle is_manually_edited flag
      const { data: current } = await supabase
        .from('content_translations')
        .select('is_manually_edited')
        .eq('id', translation_id)
        .single()

      const { error } = await supabase
        .from('content_translations')
        .update({ is_manually_edited: !current?.is_manually_edited })
        .eq('id', translation_id)

      if (error) {
        return NextResponse.json({ error: 'Failed to toggle manual flag' }, { status: 500 })
      }

      return NextResponse.json({ message: 'Manual flag toggled' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
