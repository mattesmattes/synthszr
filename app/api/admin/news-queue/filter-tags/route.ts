import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

const DEFAULT_COLORS = [
  '#CCFF00', '#00FFFF', '#FF6B00', '#FF1493', '#9D4EDD',
  '#FFD60A', '#06FFA5', '#FF006E', '#3A86FF', '#FB5607',
]

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('news_queue_filter_tags')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tags: data ?? [] })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json()
  const label = (body.label ?? '').toString().trim()
  if (!label) return NextResponse.json({ error: 'Label erforderlich' }, { status: 400 })

  const supabase = createAdminClient()

  const { count } = await supabase
    .from('news_queue_filter_tags')
    .select('*', { count: 'exact', head: true })
  const color = body.color ?? DEFAULT_COLORS[(count ?? 0) % DEFAULT_COLORS.length]

  const { data, error } = await supabase
    .from('news_queue_filter_tags')
    .insert({ label, color, sort_order: count ?? 0 })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tag: data })
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id erforderlich' }, { status: 400 })

  const supabase = createAdminClient()
  const { error } = await supabase.from('news_queue_filter_tags').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
