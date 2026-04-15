import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

const ALLOWED_FIELDS = [
  'name', 'headline', 'body', 'link_url',
  'gradient_from', 'gradient_to', 'gradient_direction', 'text_color',
  'active', 'sort_order',
] as const

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of ALLOWED_FIELDS) {
    if (key in body) update[key] = body[key]
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tip_promos')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ promo: data })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { id } = await params
  const supabase = createAdminClient()
  const { error } = await supabase.from('tip_promos').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
