/**
 * News Queue API
 * GET: List queue items and statistics
 * POST: Add items to queue
 * PATCH: Update item status/scores
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import {
  addToQueue,
  getSourceDistribution,
  getSelectableItems,
  getBalancedSelection,
  selectItemsForArticle,
  markItemsAsUsed,
  skipItems,
  expireOldItems,
  getQueueStats,
  updateScores,
  queueFromDailyRepo,
  clearPendingQueue,
  resetSelectedToPending
} from '@/lib/news-queue/service'
import { createClient } from '@/lib/supabase/server'

// GET: List queue items, stats, or distribution
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') || 'list'

  try {
    switch (action) {
      case 'stats': {
        const stats = await getQueueStats()
        return NextResponse.json(stats)
      }

      case 'distribution': {
        const distribution = await getSourceDistribution()
        return NextResponse.json(distribution)
      }

      case 'selectable': {
        const items = await getSelectableItems()
        return NextResponse.json(items)
      }

      case 'balanced': {
        const maxItems = parseInt(searchParams.get('max') || '10')
        const selection = await getBalancedSelection(maxItems)
        return NextResponse.json(selection)
      }

      case 'list':
      default: {
        const supabase = await createClient()
        const status = searchParams.get('status') || 'pending'
        const limit = parseInt(searchParams.get('limit') || '50')
        const offset = parseInt(searchParams.get('offset') || '0')

        const { data, error, count } = await supabase
          .from('news_queue')
          .select('*', { count: 'exact' })
          .eq('status', status)
          .order('total_score', { ascending: false })
          .range(offset, offset + limit - 1)

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({
          items: data,
          total: count,
          limit,
          offset
        })
      }
    }
  } catch (error) {
    console.error('[NewsQueue API] GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// POST: Add items or perform queue actions
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { action } = body

    switch (action) {
      case 'add': {
        // Add new items to queue
        const { items } = body as {
          items: Array<{
            dailyRepoId?: string
            title: string
            excerpt?: string
            content?: string
            sourceEmail?: string
            sourceUrl?: string
            synthesisScore?: number
            relevanceScore?: number
            uniquenessScore?: number
          }>
        }

        if (!items || !Array.isArray(items)) {
          return NextResponse.json({ error: 'Items array required' }, { status: 400 })
        }

        const result = await addToQueue(items)
        return NextResponse.json(result)
      }

      case 'add-from-repo': {
        // Add items from daily_repo by IDs
        const { itemIds } = body as { itemIds: string[] }

        if (!itemIds || !Array.isArray(itemIds)) {
          return NextResponse.json({ error: 'itemIds array required' }, { status: 400 })
        }

        const result = await queueFromDailyRepo(itemIds)
        return NextResponse.json(result)
      }

      case 'add-from-synthesis': {
        // Add items from synthesis_candidates with pre-calculated scores
        const { candidates } = body as {
          candidates: Array<{
            source_item_id: string
            title: string
            source_identifier: string
            source_url: string | null
            originality_score: number
            relevance_score: number
          }>
        }

        if (!candidates || !Array.isArray(candidates)) {
          return NextResponse.json({ error: 'candidates array required' }, { status: 400 })
        }

        // Map synthesis scores to queue scores
        // originality_score (0-10) -> synthesis_score (0-10)
        // relevance_score (0-10) -> relevance_score (0-10)
        // uniqueness_score calculated separately (default 5)
        const items = candidates.map(c => ({
          dailyRepoId: c.source_item_id,
          title: c.title,
          sourceEmail: c.source_identifier,
          sourceUrl: c.source_url,
          synthesisScore: c.originality_score,
          relevanceScore: c.relevance_score,
          uniquenessScore: 5 // Default, can be calculated later
        }))

        const result = await addToQueue(items)
        return NextResponse.json(result)
      }

      case 'select': {
        // Select items for article generation
        const { itemIds } = body as { itemIds: string[] }

        if (!itemIds || !Array.isArray(itemIds)) {
          return NextResponse.json({ error: 'itemIds array required' }, { status: 400 })
        }

        const result = await selectItemsForArticle(itemIds)
        if (result.error) {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }

        return NextResponse.json({ items: result.items })
      }

      case 'use': {
        // Mark items as used after article generation
        const { itemIds, postId } = body as { itemIds: string[]; postId: string }

        if (!itemIds || !postId) {
          return NextResponse.json({ error: 'itemIds and postId required' }, { status: 400 })
        }

        const result = await markItemsAsUsed(itemIds, postId)
        if (result.error) {
          return NextResponse.json({ error: result.error, updated: result.updated }, { status: 500 })
        }
        return NextResponse.json({ success: true, updated: result.updated })
      }

      case 'skip': {
        // Skip items with reason
        const { itemIds, reason } = body as { itemIds: string[]; reason: string }

        if (!itemIds || !reason) {
          return NextResponse.json({ error: 'itemIds and reason required' }, { status: 400 })
        }

        await skipItems(itemIds, reason)
        return NextResponse.json({ success: true })
      }

      case 'expire': {
        // Manually trigger expiration
        const expired = await expireOldItems()
        return NextResponse.json({ expired })
      }

      case 'clear': {
        // Clear all pending items from queue
        const cleared = await clearPendingQueue()
        return NextResponse.json({ cleared })
      }

      case 'reset-selected': {
        // Reset selected items back to pending (for unused article generations)
        const reset = await resetSelectedToPending()
        return NextResponse.json({ reset })
      }

      case 'reset-item': {
        // Reset a single item back to pending (when user removes it from a draft post)
        const { itemId } = body as { itemId: string }

        if (!itemId) {
          return NextResponse.json({ error: 'itemId required' }, { status: 400 })
        }

        const supabase = await createClient()
        const { error } = await supabase
          .from('news_queue')
          .update({
            status: 'pending',
            selected_at: null
          })
          .eq('id', itemId)
          .in('status', ['selected', 'pending']) // Only reset if selected or pending

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error) {
    console.error('[NewsQueue API] POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// PATCH: Update item scores
export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { itemId, synthesisScore, relevanceScore, uniquenessScore } = body

    if (!itemId) {
      return NextResponse.json({ error: 'itemId required' }, { status: 400 })
    }

    await updateScores(itemId, {
      synthesisScore,
      relevanceScore,
      uniquenessScore
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[NewsQueue API] PATCH error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
