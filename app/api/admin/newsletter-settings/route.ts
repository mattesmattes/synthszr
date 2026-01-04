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

// GET: Get newsletter settings
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')

  try {
    const supabase = getSupabase()

    if (key) {
      // Get specific setting
      const { data, error } = await supabase
        .from('newsletter_settings')
        .select('*')
        .eq('key', key)
        .single()

      if (error) {
        return NextResponse.json({ error: 'Setting not found' }, { status: 404 })
      }

      return NextResponse.json({ setting: data })
    }

    // Get all settings
    const { data, error } = await supabase
      .from('newsletter_settings')
      .select('*')

    if (error) {
      console.error('Fetch settings error:', error)
      return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
    }

    return NextResponse.json({ settings: data })
  } catch (error) {
    console.error('Settings GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: Update or create a setting
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getSupabase()
    const body = await request.json()
    const { key, value } = body

    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Key and value required' }, { status: 400 })
    }

    // Upsert the setting
    const { data, error } = await supabase
      .from('newsletter_settings')
      .upsert(
        {
          key,
          value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      )
      .select()
      .single()

    if (error) {
      console.error('Upsert setting error:', error)
      return NextResponse.json({ error: 'Failed to save setting' }, { status: 500 })
    }

    return NextResponse.json({ success: true, setting: data })
  } catch (error) {
    console.error('Settings POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
