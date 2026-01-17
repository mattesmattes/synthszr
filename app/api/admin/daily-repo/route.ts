/**
 * Daily Repo API
 * GET: Fetch daily_repo items by date
 * DELETE: Remove items and recalculate fetch timestamp
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { recalculateFetchTimestamp } from '@/lib/newsletter/timestamp'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')

  if (!date) {
    return NextResponse.json({ error: 'Date parameter required' }, { status: 400 })
  }

  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('daily_repo')
      .select('id, title, source_email, source_url, newsletter_date, collected_at')
      .eq('newsletter_date', date)
      .order('collected_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ items: data || [] })
  } catch (error) {
    console.error('[DailyRepo API] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE: Remove items from daily_repo and recalculate fetch timestamp
 *
 * Body options:
 * - { ids: string[] } - Delete specific items by ID
 * - { date: string } - Delete all items for a specific date
 *
 * After deletion, the last_newsletter_fetch timestamp is automatically
 * recalculated based on the remaining data in daily_repo.
 */
export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { ids, date } = body as { ids?: string[]; date?: string }

    if (!ids && !date) {
      return NextResponse.json(
        { error: 'Either ids or date parameter required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    let deletedCount = 0

    if (ids && ids.length > 0) {
      // Delete by specific IDs
      const { error, count } = await supabase
        .from('daily_repo')
        .delete()
        .in('id', ids)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      deletedCount = count || ids.length
      console.log(`[DailyRepo API] Deleted ${deletedCount} items by ID`)
    } else if (date) {
      // Delete all items for a specific date
      const { error, count } = await supabase
        .from('daily_repo')
        .delete()
        .eq('newsletter_date', date)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      deletedCount = count || 0
      console.log(`[DailyRepo API] Deleted ${deletedCount} items for date ${date}`)
    }

    // Recalculate the fetch timestamp based on remaining data
    // This ensures the next fetch will re-fetch deleted items
    await recalculateFetchTimestamp(supabase)
    console.log('[DailyRepo API] Recalculated fetch timestamp after deletion')

    return NextResponse.json({
      success: true,
      deleted: deletedCount,
      message: 'Items deleted and fetch timestamp recalculated'
    })
  } catch (error) {
    console.error('[DailyRepo API] DELETE error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
