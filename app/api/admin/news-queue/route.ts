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
  queueFromDailyRepo
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

        await markItemsAsUsed(itemIds, postId)
        return NextResponse.json({ success: true })
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
