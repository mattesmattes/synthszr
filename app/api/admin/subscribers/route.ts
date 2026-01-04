import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/session'

// Lazy initialization to avoid build-time errors
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// GET: List all subscribers
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = (page - 1) * limit

  try {
    const supabase = getSupabase()

    let query = supabase
      .from('subscribers')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    if (search) {
      query = query.ilike('email', `%${search}%`)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('Fetch subscribers error:', error)
      return NextResponse.json({ error: 'Failed to fetch subscribers' }, { status: 500 })
    }

    // Get counts by status
    const { data: statusCounts } = await supabase
      .from('subscribers')
      .select('status')

    const counts = {
      all: statusCounts?.length || 0,
      pending: statusCounts?.filter(s => s.status === 'pending').length || 0,
      active: statusCounts?.filter(s => s.status === 'active').length || 0,
      unsubscribed: statusCounts?.filter(s => s.status === 'unsubscribed').length || 0,
      bounced: statusCounts?.filter(s => s.status === 'bounced').length || 0,
    }

    return NextResponse.json({
      subscribers: data,
      total: count,
      page,
      limit,
      counts,
    })
  } catch (error) {
    console.error('Subscribers GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE: Remove a subscriber
export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'Subscriber ID required' }, { status: 400 })
  }

  try {
    const supabase = getSupabase()

    const { error } = await supabase
      .from('subscribers')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete subscriber error:', error)
      return NextResponse.json({ error: 'Failed to delete subscriber' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Subscribers DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
