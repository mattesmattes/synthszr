import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { parseIntParam } from '@/lib/validation/query-params'

// GET: List all subscribers
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const page = parseIntParam(searchParams.get('page'), 1, 1)
  const limit = parseIntParam(searchParams.get('limit'), 50, 1, 500)
  const offset = (page - 1) * limit

  try {
    const supabase = createAdminClient()

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

// PATCH: Update subscriber (activate or edit email)
export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { id, status, email } = body

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Subscriber ID required' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Verify subscriber exists
    const { data: existing, error: fetchError } = await supabase
      .from('subscribers')
      .select('id, status, email')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Subscriber not found' }, { status: 404 })
    }

    // Email update
    if (email && typeof email === 'string') {
      const trimmed = email.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return NextResponse.json({ error: 'Ungültige E-Mail-Adresse' }, { status: 400 })
      }

      // Check for duplicate
      const { data: dup } = await supabase
        .from('subscribers')
        .select('id')
        .eq('email', trimmed)
        .neq('id', id)
        .maybeSingle()

      if (dup) {
        return NextResponse.json({ error: 'E-Mail-Adresse bereits vergeben' }, { status: 409 })
      }

      const { error: updateError } = await supabase
        .from('subscribers')
        .update({ email: trimmed, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (updateError) {
        console.error('Update email error:', updateError)
        return NextResponse.json({ error: 'Failed to update email' }, { status: 500 })
      }

      console.log(`[Admin] Updated subscriber email: ${existing.email} → ${trimmed}`)
      return NextResponse.json({ success: true, email: trimmed })
    }

    // Status activation
    if (status === 'active') {
      if (existing.status !== 'pending') {
        return NextResponse.json({ error: 'Subscriber is not pending' }, { status: 400 })
      }

      const { error: updateError } = await supabase
        .from('subscribers')
        .update({
          status: 'active',
          confirmed_at: new Date().toISOString(),
          confirmation_token: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (updateError) {
        console.error('Activate subscriber error:', updateError)
        return NextResponse.json({ error: 'Failed to activate subscriber' }, { status: 500 })
      }

      console.log(`[Admin] Manually activated subscriber: ${existing.email}`)
      return NextResponse.json({ success: true, email: existing.email })
    }

    return NextResponse.json({ error: 'No valid update field provided' }, { status: 400 })
  } catch (error) {
    console.error('Subscribers PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE: Remove a subscriber
export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'Subscriber ID required' }, { status: 400 })
  }

  try {
    const supabase = createAdminClient()

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
