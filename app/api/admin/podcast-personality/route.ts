import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const locale = searchParams.get('locale')

  const supabase = createAdminClient()

  if (!locale || locale === 'all') {
    // Return all locales
    const { data, error } = await supabase
      .from('podcast_personality_state')
      .select('*')
      .order('episode_count', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ personalities: data || [] })
  }

  // Single locale
  const { data, error } = await supabase
    .from('podcast_personality_state')
    .select('*')
    .eq('locale', locale)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Return data or null (no state yet = no episodes generated)
  return NextResponse.json({ personality: data || null })
}

const ALLOWED_FIELDS = ['relationship_paused', 'mutual_comfort', 'flirtation_tendency'] as const

export async function PATCH(request: NextRequest) {
  const body = await request.json()
  const { locale, updates } = body as { locale?: string; updates?: Record<string, unknown> }

  if (!locale || !updates || typeof updates !== 'object') {
    return NextResponse.json({ error: 'locale and updates required' }, { status: 400 })
  }

  // Whitelist: only relationship-relevant fields
  const sanitized: Record<string, unknown> = {}
  for (const field of ALLOWED_FIELDS) {
    if (field in updates) {
      const val = updates[field]
      if (field === 'relationship_paused') {
        if (typeof val !== 'boolean') {
          return NextResponse.json({ error: `${field} must be boolean` }, { status: 400 })
        }
        sanitized[field] = val
      } else {
        if (typeof val !== 'number' || val < 0 || val > 1) {
          return NextResponse.json({ error: `${field} must be a number between 0 and 1` }, { status: 400 })
        }
        sanitized[field] = Math.round(val * 1000) / 1000 // 3 decimal precision
      }
    }
  }

  if (Object.keys(sanitized).length === 0) {
    return NextResponse.json({ error: 'No valid fields in updates' }, { status: 400 })
  }

  sanitized.updated_at = new Date().toISOString()

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('podcast_personality_state')
    .update(sanitized)
    .eq('locale', locale)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ personality: data })
}
