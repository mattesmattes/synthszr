/**
 * Daily Repo API
 * GET: Fetch daily_repo items by date
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

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
